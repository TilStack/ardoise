import { randomUUID } from 'node:crypto';
import { LedgerService } from '../src/ledger/ledger.service';
import { addCustomer, addEntry, bootApp, login, TestCtx } from './helpers';

describe('Boutique : auth, clients, dettes, synchro', () => {
  let ctx: TestCtx;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await bootApp();
  });
  afterAll(() => ctx.app.close());

  describe('authentification OTP', () => {
    it('refuse un numéro invalide', async () => {
      await ctx.http().post('/auth/otp/request').send({ phone: '12345' }).expect(400);
    });

    it('bloque après 3 codes faux, puis impose un délai avant un nouveau code', async () => {
      const phone = '690000001';
      await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
      for (let i = 0; i < 3; i++) {
        await ctx.http().post('/auth/otp/verify').send({ phone, code: '000000' }).expect(401);
      }
      const r = await ctx.http().post('/auth/otp/verify').send({ phone, code: '000000' }).expect(401);
      expect(r.body.message).toMatch(/expiré/);
      await ctx.http().post('/auth/otp/request').send({ phone }).expect(400);
    });

    it('connecte le commerçant avec le bon code et protège les routes', async () => {
      await ctx.http().get('/me').expect(401);
      auth = await login(ctx, '677 11 22 33');
      const me = await ctx.http().get('/me').set(auth).expect(200);
      expect(me.body).toMatchObject({ phone: '+237677112233', shopName: 'Boutique Brigitte' });
    });
  });

  describe('clients et écritures', () => {
    let paul: string;

    it('crée un client, détecte l’opérateur, et reste idempotent sur le numéro', async () => {
      paul = await addCustomer(ctx, auth, 'Paul Ngono', '6 77 12 34 56');
      const again = await ctx.http().post('/customers').set(auth).send({ name: 'Paul', phone: '+237677123456' }).expect(201);
      expect(again.body.id).toBe(paul);
      expect(again.body.operator).toBe('MTN');
    });

    it('un client créé hors-ligne garde l’identifiant généré par le téléphone', async () => {
      const clientUuid = randomUUID();
      const r = await ctx.http().post('/customers').set(auth).send({ clientUuid, name: 'Maman Clarisse', phone: '655 44 33 22' }).expect(201);
      expect(r.body.id).toBe(clientUuid);
      expect(r.body.operator).toBe('ORANGE');
      const again = await ctx.http().post('/customers').set(auth).send({ clientUuid, name: 'Maman Clarisse', phone: '655 44 33 22' }).expect(201);
      expect(again.body.id).toBe(clientUuid);
    });

    it('dette puis remboursement partiel en espèces : le solde est la somme des écritures', async () => {
      const d = await addEntry(ctx, auth, paul, 'DEBT', 5000, { label: 'Riz 5 kg, huile 1 L' });
      expect(d.balance).toBe(5000);
      const c = await addEntry(ctx, auth, paul, 'CASH_REPAYMENT', 2000);
      expect(c.balance).toBe(3000);
    });

    it('rejeter la même saisie (même clientUuid) ne crée rien de plus', async () => {
      const clientUuid = randomUUID();
      const body = { clientUuid, customerId: paul, type: 'DEBT', amount: 1500 };
      const a = await ctx.http().post('/entries').set(auth).send(body).expect(201);
      const b = await ctx.http().post('/entries').set(auth).send(body).expect(201);
      expect(b.body.duplicate).toBe(true);
      expect(b.body.entry.id).toBe(a.body.entry.id);
      expect(b.body.balance).toBe(4500);
    });

    it('refuse les montants non entiers, nuls ou démesurés', async () => {
      for (const amount of [0, -100, 12.5, 50_000_000]) {
        await ctx.http().post('/entries').set(auth).send({ clientUuid: randomUUID(), customerId: paul, type: 'DEBT', amount }).expect(400);
      }
    });

    it('synchronise un lot hors-ligne rejoué 3 fois sans doublon', async () => {
      const batch = {
        entries: [
          { clientUuid: randomUUID(), customerId: paul, type: 'DEBT', amount: 1000, occurredAt: new Date(Date.now() - 3_600_000).toISOString() },
          { clientUuid: randomUUID(), customerId: paul, type: 'CASH_REPAYMENT', amount: 500 },
        ],
      };
      for (let i = 0; i < 3; i++) {
        const r = await ctx.http().post('/sync/entries').set(auth).send(batch).expect(200);
        expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(i === 0 ? ['CREATED', 'CREATED'] : ['DUPLICATE', 'DUPLICATE']);
      }
      const detail = await ctx.http().get(`/customers/${paul}`).set(auth).expect(200);
      expect(detail.body.balance).toBe(5000);
    });

    it('annule une saisie par écriture inverse, visible dans l’historique, une seule fois', async () => {
      const d = await addEntry(ctx, auth, paul, 'DEBT', 700, { label: 'Savon x2' });
      const cancel = await ctx.http().post(`/entries/${d.entry.id}/cancel`).set(auth).send({ clientUuid: randomUUID(), reason: 'Saisie en double' }).expect(201);
      expect(cancel.body.balance).toBe(5000);
      await ctx.http().post(`/entries/${d.entry.id}/cancel`).set(auth).send({ clientUuid: randomUUID() }).expect(409);
      const detail = await ctx.http().get(`/customers/${paul}`).set(auth).expect(200);
      const savon = detail.body.history.find((h: { id: string }) => h.id === d.entry.id);
      expect(savon.reversed).toBe(true);
    });

    it('signale le dépassement du plafond de crédit', async () => {
      const id = await addCustomer(ctx, auth, 'Junior (taxi)', '699 00 11 22');
      await ctx.http().patch(`/customers/${id}`).set(auth).send({ creditLimit: 2000 }).expect(200);
      const r = await addEntry(ctx, auth, id, 'DEBT', 2500);
      expect(r.overLimit).toBe(true);
    });

    it('isole les boutiques entre elles', async () => {
      const other = await login(ctx, '655 99 88 77', 'Autre boutique');
      const list = await ctx.http().get('/customers').set(other).expect(200);
      expect(list.body.customers).toHaveLength(0);
      await ctx.http().get(`/customers/${paul}`).set(other).expect(404);
      await ctx.http().post('/entries').set(other).send({ clientUuid: randomUUID(), customerId: paul, type: 'DEBT', amount: 100 }).expect(404);
    });

    it('tableau de bord cohérent et grand livre équilibré', async () => {
      const r = await ctx.http().get('/dashboard').set(auth).expect(200);
      expect(r.body).toMatchObject({ totalOwed: 7500, customersCount: 3, inTransit: 0, collectedThisMonth: 2500 });
      expect(await ctx.app.get(LedgerService).unbalancedEntries()).toEqual([]);
    });
  });
});
