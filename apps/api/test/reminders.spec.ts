import { ConsoleSmsSender, SmsSender } from '../src/auth/auth';
import { ConsoleWhatsAppSender, WhatsAppSender } from '../src/reminders/messaging';
import { RemindersService } from '../src/reminders/reminders.service';
import { atDoualaHour, OPT_OUT_SUFFIX } from '../src/reminders/rules';
import { addCustomer, addEntry, bootApp, login, resetDb, TestCtx } from './helpers';

/**
 * Le temps est simulé : chaque appel reçoit son « maintenant ». Les dettes sont datées dans le passé
 * (saisie hors-ligne), à partir de T0 = il y a 30 jours, 10 h à Douala.
 */
describe('Relances automatiques J+3, J+7, J+14', () => {
  let ctx: TestCtx;
  let svc: RemindersService;
  let wa: ConsoleWhatsAppSender;
  let sms: ConsoleSmsSender;
  let auth: Record<string, string>;
  let merchantId: string;
  let phoneSeq = 0;

  const T0 = atDoualaHour(new Date(), 10, -30);
  /** Jour J+day, à `hour` h `min`, heure de Douala. */
  const D = (day: number, hour: number, min = 0) => new Date(atDoualaHour(T0, hour, day).getTime() + min * 60_000);

  beforeAll(async () => {
    ctx = await bootApp();
    svc = ctx.app.get(RemindersService);
    wa = ctx.app.get(WhatsAppSender) as ConsoleWhatsAppSender;
    sms = ctx.app.get(SmsSender) as ConsoleSmsSender;
  });
  afterAll(() => ctx.app.close());

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    wa.outbox.length = 0;
    wa.unreachable.clear();
    sms.outbox.length = 0;
    auth = await login(ctx, `69900${String(++phoneSeq).padStart(4, '1')}`);
    merchantId = (await ctx.http().get('/me').set(auth).expect(200)).body.id;
  });

  const debt = async (name: string, phone: string, amount: number, at = T0) => {
    const id = await addCustomer(ctx, auth, name, phone);
    await addEntry(ctx, auth, id, 'DEBT', amount, { occurredAt: at.toISOString() });
    return id;
  };
  const reminders = (customerId: string) => ctx.prisma.reminder.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } });
  const tick = async (now: Date) => {
    await svc.plan(merchantId, now);
    const r = await svc.dispatchDue(now);
    await svc.plan(merchantId, now);
    return r;
  };

  it('envoie J+3, J+7 et J+14 à 9 h par WhatsApp, avec un lien de paiement, puis s’arrête', async () => {
    const paul = await debt('Paul Ngono', '677 12 34 56', 12500);

    await svc.plan(merchantId, D(0, 11));
    const [first] = await reminders(paul);
    expect(first).toMatchObject({ step: 3, status: 'SCHEDULED', channel: 'WHATSAPP' });
    expect(first.scheduledAt).toEqual(D(3, 9));

    expect((await tick(D(2, 10))).sent).toBe(0); // pas encore J+3
    expect((await tick(D(3, 9, 5))).sent).toBe(1);
    expect(wa.outbox).toHaveLength(1);
    expect(wa.outbox[0].phone).toBe('+237677123456');
    expect(wa.outbox[0].text).toMatch(/^Bonjour Paul, petit rappel : 12 500 FCFA à la Boutique Brigitte\. Payez ici : https:\/\/pay\.test\/p\/\S+/);
    expect(wa.outbox[0].text.endsWith(OPT_OUT_SUFFIX)).toBe(true);
    expect((await tick(D(3, 9, 10))).sent).toBe(0); // idempotent

    // Le lien du message ouvre bien la page de paiement de Paul
    const token = wa.outbox[0].text.match(/\/p\/(\S+)/)![1];
    const view = await ctx.http().get(`/public/links/${token}`).expect(200);
    expect(view.body.balance).toBe(12500);

    expect((await tick(D(7, 21))).sent).toBe(0); // J+7 mais 21 h : hors plage
    expect((await tick(D(8, 9, 5))).sent).toBe(1);
    expect((await tick(D(14, 9, 5))).sent).toBe(1);
    expect((await tick(D(20, 9, 5))).sent).toBe(0);

    const all = await reminders(paul);
    expect(all.map((r) => [r.step, r.status])).toEqual([
      [3, 'SENT'],
      [7, 'SENT'],
      [14, 'SENT'],
    ]);
    expect(all.every((r) => r.amount === 12500 && r.paymentLinkId && r.sentChannel === 'WHATSAPP')).toBe(true);
  });

  it('au plus 1 message par 48 h, et un seul message en cas de rattrapage', async () => {
    const sandrine = await debt('Sandrine Kamga', '699 11 22 33', 4200);
    // Le service n'a pas tourné pendant 13 jours : J+3 et J+7 sont échus → un seul message (J+7).
    expect((await tick(D(13, 10))).sent).toBe(1);
    const [r7, r14] = await reminders(sandrine);
    expect(r7.step).toBe(7);
    // J+14 tombe 23 h plus tard : reporté à 48 h après le message précédent.
    expect(r14).toMatchObject({ step: 14, status: 'SCHEDULED' });
    expect(r14.scheduledAt).toEqual(D(15, 10));
    expect((await tick(D(14, 9, 5))).sent).toBe(0);
    expect((await tick(D(15, 10, 1))).sent).toBe(1);
    expect(wa.outbox).toHaveLength(2);
  });

  it('repli SMS si le client n’a pas WhatsApp', async () => {
    const junior = await debt('Junior (taxi)', '650 00 11 22', 1500);
    wa.unreachable.add('+237650001122');
    await tick(D(3, 9, 5));
    const [r] = await reminders(junior);
    expect(r).toMatchObject({ status: 'SENT', channel: 'WHATSAPP', sentChannel: 'SMS' });
    expect(r.error).toMatch(/WhatsApp/);
    expect(sms.outbox.at(-1)).toMatchObject({ phone: '+237650001122' });
    expect(sms.outbox.at(-1)!.text).toMatch(/1 500 FCFA/);
  });

  it('dette réglée : la relance programmée est annulée ; le paiement est attribué à la relance', async () => {
    const eric = await debt('Éric Atangana', '677 98 76 54', 8000);
    await tick(D(3, 9, 5));
    await addEntry(ctx, auth, eric, 'CASH_REPAYMENT', 8000, { occurredAt: D(4, 16).toISOString() });
    await tick(D(7, 9, 5));
    const rows = await reminders(eric);
    expect(rows.map((r) => [r.step, r.status])).toEqual([
      [3, 'SENT'],
      [7, 'CANCELLED'],
    ]);
    expect(wa.outbox).toHaveLength(1);

    const o = await ctx.http().get('/reminders').set(auth).expect(200);
    expect(o.body.counts).toEqual({ scheduled: 0, sent: 1, paid: 1 });
    expect(o.body.recovered).toBe(8000);
    expect(o.body.paid[0]).toMatchObject({ customerName: 'Éric Atangana', step: 3, amount: 8000, paidAmount: 8000 });
  });

  it('nouvelle dette après remboursement : nouveau cycle qui repart de J+3', async () => {
    const id = await debt('Maman Clarisse', '655 44 33 22', 3000);
    await tick(D(3, 9, 5));
    await addEntry(ctx, auth, id, 'CASH_REPAYMENT', 3000, { occurredAt: D(5, 10).toISOString() });
    await addEntry(ctx, auth, id, 'DEBT', 2000, { occurredAt: D(10, 17).toISOString() });
    await svc.plan(merchantId, D(10, 18));
    const next = (await reminders(id)).find((r) => r.status === 'SCHEDULED')!;
    expect(next.step).toBe(3);
    expect(next.scheduledAt).toEqual(D(13, 9));
  });

  it('consentement : le client se désinscrit depuis le lien reçu, plus aucun message', async () => {
    const paul = await debt('Paul Ngono', '677 12 34 56', 12500);
    await tick(D(3, 9, 5));
    const token = wa.outbox[0].text.match(/\/p\/(\S+)/)![1];
    await ctx.http().post(`/public/links/${token}/opt-out`).expect(200);
    const c = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: paul } });
    expect(c.consentReminders).toBe(false);
    expect((await reminders(paul)).filter((r) => r.status === 'SCHEDULED')).toHaveLength(0);
    expect((await tick(D(8, 9, 5))).sent).toBe(0);
    await ctx.http().post('/public/links/jeton-inconnu/opt-out').expect(404);

    // Le commerçant peut aussi couper les rappels d'un client depuis sa fiche
    const sk = await debt('Sandrine Kamga', '699 11 22 33', 4200);
    await ctx.http().patch(`/customers/${sk}`).set(auth).send({ consentReminders: false }).expect(200);
    expect((await tick(D(3, 9, 5))).sent).toBe(0);
  });

  it('réglages : message personnalisé validé, heure d’envoi, désactivation', async () => {
    const paul = await debt('Paul Ngono', '677 12 34 56', 12500);
    await ctx.http().patch('/reminders/settings').set(auth).send({ template: 'Payez svp' }).expect(400);
    await ctx.http().patch('/reminders/settings').set(auth).send({ sendHour: 7 }).expect(400);
    await ctx.http().patch('/reminders/settings').set(auth).send({ sendHour: 20 }).expect(400);
    const s = await ctx
      .http()
      .patch('/reminders/settings')
      .set(auth)
      .send({ template: 'Salut {prenom}, {montant} F chez {boutique} : {lien}', sendHour: 18 })
      .expect(200);
    expect(s.body).toMatchObject({ sendHour: 18, customTemplate: true });

    await svc.plan(merchantId, D(0, 11));
    expect((await reminders(paul))[0].scheduledAt).toEqual(D(3, 18));
    expect((await tick(D(3, 9, 5))).sent).toBe(0);
    expect((await tick(D(3, 18, 1))).sent).toBe(1);
    expect(wa.outbox[0].text).toMatch(/^Salut Paul, 12 500 F chez Boutique Brigitte : https:\/\/pay\.test\/p\//);

    await ctx.http().patch('/reminders/settings').set(auth).send({ template: null, enabled: false }).expect(200);
    expect((await reminders(paul)).find((r) => r.status === 'SCHEDULED')).toBeUndefined();
    expect((await tick(D(8, 18, 1))).sent).toBe(0);
    const o = await ctx.http().get('/reminders').set(auth).expect(200);
    expect(o.body.settings).toMatchObject({ enabled: false, customTemplate: false, template: o.body.settings.defaultTemplate });
  });

  it('« Modifier » : reporter, ignorer, changer de canal, envoyer maintenant ; isolé par boutique', async () => {
    const paul = await debt('Paul Ngono', '677 12 34 56', 12500);
    await svc.plan(merchantId, D(0, 11));
    let [r] = await reminders(paul);

    await svc.act(merchantId, r.id, 'postpone', undefined, D(0, 12));
    expect((await reminders(paul))[0].scheduledAt).toEqual(D(4, 9));
    await ctx.http().patch(`/reminders/${r.id}`).set(auth).send({ action: 'oublier' }).expect(400);
    const ch = await ctx.http().patch(`/reminders/${r.id}`).set(auth).send({ action: 'set_channel', channel: 'SMS' }).expect(200);
    expect(ch.body.reminder.channel).toBe('SMS');

    const other = await login(ctx, '699 88 77 66', 'Autre boutique');
    await ctx.http().patch(`/reminders/${r.id}`).set(other).send({ action: 'skip' }).expect(404);

    await ctx.http().patch(`/reminders/${r.id}`).set(auth).send({ action: 'skip' }).expect(200);
    await ctx.http().patch(`/reminders/${r.id}`).set(auth).send({ action: 'skip' }).expect(409);
    await svc.plan(merchantId, D(1, 11));
    r = (await reminders(paul)).find((x) => x.status === 'SCHEDULED')!;
    expect(r.step).toBe(7);

    // Envoyer maintenant : respecte la plage horaire
    await expect(svc.act(merchantId, r.id, 'send_now', undefined, D(1, 22))).rejects.toThrow(/8 h et 20 h/);
    const now = await svc.act(merchantId, r.id, 'send_now', undefined, D(1, 12));
    expect(now.outcome).toBe('sent');
    expect(now.reminder).toMatchObject({ step: 7, status: 'SENT', sentChannel: 'WHATSAPP' }); // le nouveau palier reprend le canal de la boutique
    expect(wa.outbox.at(-1)!.text).toMatch(/12 500 FCFA/);
  });

  it('concurrence : deux envois simultanés du même rappel → un seul message ; planifications parallèles → un seul rappel', async () => {
    const paul = await debt('Paul Ngono', '677 12 34 56', 12500);
    await Promise.all([svc.plan(merchantId, D(0, 11)), svc.plan(merchantId, D(0, 11)), svc.plan(merchantId, D(0, 11))]);
    const rows = await reminders(paul);
    expect(rows).toHaveLength(1);
    const outcomes = await Promise.all([svc.sendOne(rows[0].id, D(3, 9, 5)), svc.sendOne(rows[0].id, D(3, 9, 5)), svc.sendOne(rows[0].id, D(3, 9, 5))]);
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'taken')).toHaveLength(2);
    expect(wa.outbox).toHaveLength(1);
  });

  it('envoi interrompu (arrêt brutal) : marqué en échec, jamais renvoyé en double', async () => {
    const paul = await debt('Paul Ngono', '677 12 34 56', 12500);
    await svc.plan(merchantId, D(0, 11));
    const [r] = await reminders(paul);
    await ctx.prisma.reminder.update({ where: { id: r.id }, data: { status: 'SENDING' } });
    expect(await svc.recoverStuck(new Date(Date.now() + 11 * 60_000))).toBe(1);
    expect((await ctx.prisma.reminder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('FAILED');
    expect(wa.outbox).toHaveLength(0);
  });

  it('écran Relances : programmées du jour, montants, réglages par défaut', async () => {
    await debt('Paul Ngono', '677 12 34 56', 12500, atDoualaHour(new Date(), 10, -1));
    const o = await ctx.http().get('/reminders').set(auth).expect(200);
    expect(o.body.settings).toMatchObject({ enabled: true, sendHour: 9, channel: 'WHATSAPP', customTemplate: false });
    expect(o.body.settings.defaultTemplate).toBe('Bonjour {prénom}, petit rappel : {montant} FCFA à la {boutique}. Payez ici : {lien}');
    expect(o.body.counts.scheduled).toBe(1);
    expect(o.body.scheduled[0]).toMatchObject({ customerName: 'Paul Ngono', amount: 12500, step: 3, channel: 'WHATSAPP' });
    await ctx.http().get('/reminders').expect(401);
  });
});
