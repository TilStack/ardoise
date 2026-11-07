import { LedgerService } from '../src/ledger/ledger.service';
import { addCustomer, addEntry, bootApp, deliverWebhook, login, TestCtx } from './helpers';

describe('Paiements Mobile Money (critères d’acceptation)', () => {
  let ctx: TestCtx;
  let auth: Record<string, string>;
  let paul: string;
  let token: string;

  const balance = async () => (await ctx.http().get(`/customers/${paul}`).set(auth).expect(200)).body.balance as number;
  const pay = (amount: number, phone = '677123456', operator = 'MTN') =>
    ctx.http().post(`/public/links/${token}/payments`).send({ amount, phone, operator });
  const providerRefOf = async (txId: string) => (await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: txId } })).providerRef!;
  const mobileEntries = (txId: string) => ctx.prisma.ledgerEntry.count({ where: { transactionId: txId } });

  beforeAll(async () => {
    ctx = await bootApp();
    auth = await login(ctx, '677 11 22 33');
    paul = await addCustomer(ctx, auth, 'Paul Ngono', '677123456');
    await addEntry(ctx, auth, paul, 'DEBT', 5000);
    const link = await ctx.http().post(`/customers/${paul}/payment-link`).set(auth).expect(201);
    token = link.body.token;
    expect(link.body.url).toBe(`https://pay.test/p/${token}`);
    expect(link.body.message).toContain('5 000 FCFA');
  });
  afterAll(() => ctx.app.close());

  it('la page publique montre le solde sans exiger de compte', async () => {
    const r = await ctx.http().get(`/public/links/${token}`).expect(200);
    expect(r.body).toMatchObject({ shopName: 'Boutique Brigitte', customerFirstName: 'Paul', balance: 5000, minAmount: 100 });
    await ctx.http().get('/public/links/jeton-bidon').expect(404);
  });

  it('sert la page de paiement légère, avec des en-têtes de sécurité', async () => {
    const r = await ctx.http().get(`/p/${token}`).expect(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Buffer.byteLength(r.text)).toBeLessThan(150 * 1024);
    expect(r.text).not.toContain(token); // le jeton n'est jamais réinjecté dans le HTML
  });

  it('borne le montant : minimum 100 FCFA, maximum le solde', async () => {
    await pay(50).expect(400);
    await pay(5001).expect(400);
    await pay(100, '12345').expect(400);
  });

  it('paiement partiel de 2 000 sur 5 000 : solde 3 000 et reçu', async () => {
    const r = await pay(2000).expect(201);
    expect(r.body.status).toBe('PENDING');
    expect(await balance()).toBe(5000); // rien n'est crédité avant confirmation

    const dash = await ctx.http().get('/dashboard').set(auth).expect(200);
    expect(dash.body.inTransit).toBe(2000);

    await deliverWebhook(ctx, ctx.sandbox.simulate(await providerRefOf(r.body.id), 'SUCCESS')).expect(200);
    expect(await balance()).toBe(3000);

    const st = await ctx.http().get(`/public/links/${token}/payments/${r.body.id}`).expect(200);
    expect(st.body.status).toBe('SUCCESS');
    expect(st.body.receipt).toMatchObject({ balanceAfter: 3000 });
    expect(st.body.receipt.number).toMatch(/^ARD-\d{4}-\d{4}$/);
  });

  it('le même webhook reçu 3 fois ne crédite qu’une fois', async () => {
    const r = await pay(500).expect(201);
    const wh = ctx.sandbox.simulate(await providerRefOf(r.body.id), 'SUCCESS');
    for (let i = 0; i < 3; i++) await deliverWebhook(ctx, wh).expect(200);
    expect(await mobileEntries(r.body.id)).toBe(1);
    expect(await balance()).toBe(2500);
  });

  it('des webhooks concurrents ne créditent qu’une fois (verrou + unicité)', async () => {
    const r = await pay(300).expect(201);
    const wh = ctx.sandbox.simulate(await providerRefOf(r.body.id), 'SUCCESS');
    await Promise.all(Array.from({ length: 6 }, () => ctx.payments.handleWebhook(Buffer.from(wh.body), wh.headers)));
    expect(await mobileEntries(r.body.id)).toBe(1);
    expect(await balance()).toBe(2200);
  });

  it('un webhook à signature invalide est rejeté et journalisé', async () => {
    const r = await pay(200).expect(201);
    const wh = ctx.sandbox.simulate(await providerRefOf(r.body.id), 'SUCCESS');
    await deliverWebhook(ctx, { body: wh.body, headers: { 'x-sandbox-signature': 'deadbeef'.repeat(8) } }).expect(401);
    await deliverWebhook(ctx, { body: wh.body.replace('200', '9000'), headers: wh.headers }).expect(401);
    expect(await mobileEntries(r.body.id)).toBe(0);
    const logged = await ctx.prisma.providerEvent.count({ where: { kind: 'WEBHOOK', signatureOk: false } });
    expect(logged).toBe(2);
    // le vrai webhook passe ensuite normalement
    await deliverWebhook(ctx, wh).expect(200);
    expect(await balance()).toBe(2000);
  });

  it('un paiement refusé ou expiré ne change pas le solde et peut être retenté', async () => {
    const failed = await pay(1000, '677120000').expect(201);
    expect(failed.body.status).toBe('FAILED');
    const r = await pay(1000).expect(201);
    await deliverWebhook(ctx, ctx.sandbox.simulate(await providerRefOf(r.body.id), 'EXPIRED')).expect(200);
    expect((await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('EXPIRED');
    // un succès tardif sur une transaction finale est ignoré
    await deliverWebhook(ctx, ctx.sandbox.simulate(await providerRefOf(r.body.id), 'SUCCESS')).expect(200);
    expect(await balance()).toBe(2000);
    const retry = await pay(1000).expect(201);
    expect(retry.body.status).toBe('PENDING');
  });

  it('un webhook perdu est rattrapé par la tâche de rattrapage', async () => {
    const r = await pay(400).expect(201);
    ctx.sandbox.simulate(await providerRefOf(r.body.id), 'SUCCESS'); // webhook jamais livré
    expect(await balance()).toBe(2000);
    const res = await ctx.payments.recoverStale(new Date(Date.now() + 6 * 60_000));
    expect(res.checked).toBeGreaterThanOrEqual(1);
    expect(await balance()).toBe(1600);
  });

  it('fournisseur injoignable : transaction incertaine laissée en attente, puis expirée si orpheline', async () => {
    const r = await pay(100, '677129999').expect(201);
    expect(r.body.status).toBe('PENDING');
    await ctx.payments.recoverStale(new Date(Date.now() + 2 * 3_600_000));
    const tx = await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(tx.status).toBe('EXPIRED');
    expect(await balance()).toBe(1600);
  });

  it('un montant confirmé différent est crédité tel quel et signalé pour revue', async () => {
    const r = await pay(600).expect(201);
    await deliverWebhook(ctx, ctx.sandbox.simulate(await providerRefOf(r.body.id), 'SUCCESS', 550)).expect(200);
    const tx = await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(tx).toMatchObject({ status: 'SUCCESS', confirmedAmount: 550, reviewRequired: true });
    expect(await balance()).toBe(1050);
  });

  it('après tout ça : grand livre équilibré, une écriture par paiement réussi, reçus cohérents', async () => {
    expect(await ctx.app.get(LedgerService).unbalancedEntries()).toEqual([]);
    const successes = await ctx.prisma.transaction.findMany({ where: { status: 'SUCCESS' }, include: { entry: { include: { receipt: true } } } });
    for (const t of successes) {
      expect(t.entry?.amount).toBe(t.confirmedAmount);
      expect(t.entry?.receipt).toBeTruthy();
    }
    const total = successes.reduce((s, t) => s + (t.confirmedAmount ?? 0), 0);
    expect(5000 - total).toBe(await balance());
  });

  it('l’outil sandbox simule une validation de bout en bout via HTTP', async () => {
    const r = await pay(50 + 50).expect(201);
    const sim = await ctx.http().post(`/dev/sandbox/${r.body.id}/success`).expect(200);
    expect(sim.body.status).toBe('SUCCESS');
    expect(await balance()).toBe(950);
  });
});
