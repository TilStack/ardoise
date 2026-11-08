import { randomUUID } from 'node:crypto';
import { addCustomer, addEntry, bootApp, login, TestCtx } from './helpers';

describe('Suppression du compte', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await bootApp();
  });
  afterAll(() => ctx.app.close());

  const counts = async (merchantId: string) => ({
    customers: await ctx.prisma.customer.count({ where: { merchantId } }),
    entries: await ctx.prisma.ledgerEntry.count({ where: { merchantId } }),
    lines: await ctx.prisma.ledgerLine.count({ where: { entry: { merchantId } } }),
    links: await ctx.prisma.paymentLink.count({ where: { merchantId } }),
    receipts: await ctx.prisma.receipt.count({ where: { merchantId } }),
  });

  it('refuse tant qu’un client doit encore de l’argent, et ne supprime rien', async () => {
    const auth = await login(ctx, '677 40 40 40');
    const id = await addCustomer(ctx, auth, 'Paul Ngono', '677 12 34 56');
    await addEntry(ctx, auth, id, 'DEBT', 5000);

    const r = await ctx.http().delete('/me').set(auth).expect(409);
    expect(r.body.message).toMatch(/1 compte non réglé/);
    await ctx.http().get('/me').set(auth).expect(200);
    const detail = await ctx.http().get(`/customers/${id}`).set(auth).expect(200);
    expect(detail.body.balance).toBe(5000);
  });

  it('supprime le compte et toutes ses données une fois les comptes réglés', async () => {
    const auth = await login(ctx, '677 41 41 41');
    const me = await ctx.http().get('/me').set(auth).expect(200);
    const merchantId = me.body.id as string;

    const a = await addCustomer(ctx, auth, 'Marie Fotso', '655 44 33 22');
    const b = await addCustomer(ctx, auth, 'Jean Kamga', '699 00 11 22');
    // Dette payée en espèces, avec un lien de paiement créé entre-temps.
    await addEntry(ctx, auth, a, 'DEBT', 5000);
    await ctx.http().post(`/customers/${a}/payment-link`).set(auth).expect(201);
    await addEntry(ctx, auth, a, 'CASH_REPAYMENT', 5000);
    // Dette annulée par une écriture inverse.
    const debt = await addEntry(ctx, auth, b, 'DEBT', 2000);
    await ctx.http().post(`/entries/${debt.entry.id}/cancel`).set(auth).send({ clientUuid: randomUUID(), reason: 'Erreur' }).expect(201);

    expect((await counts(merchantId)).entries).toBeGreaterThanOrEqual(4);
    expect((await counts(merchantId)).links).toBe(1);

    await ctx.http().delete('/me').set(auth).expect(200);

    expect(await counts(merchantId)).toEqual({ customers: 0, entries: 0, lines: 0, links: 0, receipts: 0 });
    expect(await ctx.prisma.merchant.count({ where: { id: merchantId } })).toBe(0);
    await ctx.http().get('/me').set(auth).expect(404);
  });

  it('ne touche pas aux données des autres comptes', async () => {
    const mine = await login(ctx, '677 42 42 42');
    const other = await login(ctx, '655 42 42 42', 'Autre boutique');
    const otherMe = await ctx.http().get('/me').set(other).expect(200);
    const c = await addCustomer(ctx, other, 'Client voisin', '677 77 77 77');
    await addEntry(ctx, other, c, 'DEBT', 1000);

    await ctx.http().delete('/me').set(mine).expect(200);

    expect((await counts(otherMe.body.id)).customers).toBe(1);
    expect((await counts(otherMe.body.id)).entries).toBe(1);
    await ctx.http().get('/me').set(other).expect(200);
  });

  it('on peut se réinscrire avec le même numéro : le compte repart à zéro', async () => {
    const auth = await login(ctx, '677 43 43 43');
    const id = await addCustomer(ctx, auth, 'Ancien client', '677 12 12 12');
    await ctx.http().patch('/me').set(auth).send({ profileType: 'PERSONAL', shopName: 'Brice' }).expect(200);
    expect(id).toBeTruthy();
    await ctx.http().delete('/me').set(auth).expect(200);

    const r1 = await ctx.http().post('/auth/otp/request').send({ phone: '677 43 43 43' }).expect(200);
    const r2 = await ctx.http().post('/auth/otp/verify').send({ phone: '677 43 43 43', code: r1.body.devCode }).expect(200);
    expect(r2.body.merchant.profileType).toBeNull();
    const again = { Authorization: `Bearer ${r2.body.token}` };
    const list = await ctx.http().get('/customers').set(again).expect(200);
    expect(list.body.customers).toEqual([]);
  });
});
