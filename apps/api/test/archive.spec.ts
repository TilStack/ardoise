import { addCustomer, addEntry, bootApp, login, TestCtx } from './helpers';

describe('Archivage des clients', () => {
  let ctx: TestCtx;
  let auth: Record<string, string>;

  beforeAll(async () => {
    ctx = await bootApp();
    auth = await login(ctx, '677 11 22 33');
  });
  afterAll(() => ctx.app.close());

  const names = async (query = '') => {
    const r = await ctx.http().get(`/customers${query}`).set(auth).expect(200);
    return (r.body.customers as { name: string }[]).map((c) => c.name);
  };

  it('refuse d’archiver un client qui doit encore de l’argent', async () => {
    const id = await addCustomer(ctx, auth, 'Paul Ngono', '677 12 34 56');
    await addEntry(ctx, auth, id, 'DEBT', 5000);
    const r = await ctx.http().post(`/customers/${id}/archive`).set(auth).expect(409);
    expect(r.body.message).toMatch(/solde/);
    expect(await names()).toContain('Paul Ngono');
  });

  it('archive un client soldé : il quitte la liste mais son historique reste', async () => {
    const id = await addCustomer(ctx, auth, 'Marie Fotso', '655 44 33 22');
    await addEntry(ctx, auth, id, 'DEBT', 3000);
    await addEntry(ctx, auth, id, 'CASH_REPAYMENT', 3000);

    const r = await ctx.http().post(`/customers/${id}/archive`).set(auth).expect(200);
    expect(r.body.archivedAt).not.toBeNull();

    expect(await names()).not.toContain('Marie Fotso');
    expect(await names('?archived=true')).toEqual(['Marie Fotso']);

    const detail = await ctx.http().get(`/customers/${id}`).set(auth).expect(200);
    expect(detail.body.history).toHaveLength(2);
    expect(detail.body.balance).toBe(0);
  });

  it('archiver deux fois est sans effet : la date d’archivage ne change pas', async () => {
    const id = await addCustomer(ctx, auth, 'Jean Kamga', '699 00 11 22');
    const first = await ctx.http().post(`/customers/${id}/archive`).set(auth).expect(200);
    const again = await ctx.http().post(`/customers/${id}/archive`).set(auth).expect(200);
    expect(again.body.archivedAt).toBe(first.body.archivedAt);
  });

  it('désarchive un client', async () => {
    const id = await addCustomer(ctx, auth, 'Rose Mbarga', '677 99 88 77');
    await ctx.http().post(`/customers/${id}/archive`).set(auth).expect(200);
    expect(await names()).not.toContain('Rose Mbarga');
    const r = await ctx.http().post(`/customers/${id}/unarchive`).set(auth).expect(200);
    expect(r.body.archivedAt).toBeNull();
    expect(await names()).toContain('Rose Mbarga');
  });

  it('une nouvelle saisie sur un client archivé le réactive (synchro hors-ligne tardive)', async () => {
    const id = await addCustomer(ctx, auth, 'Alain Tchouta', '677 55 66 77');
    await ctx.http().post(`/customers/${id}/archive`).set(auth).expect(200);
    await addEntry(ctx, auth, id, 'DEBT', 1000);
    expect(await names()).toContain('Alain Tchouta');
  });

  it('recréer un client archivé avec le même numéro le réactive avec son historique', async () => {
    const id = await addCustomer(ctx, auth, 'Sylvie Nana', '690 12 12 12');
    await addEntry(ctx, auth, id, 'DEBT', 2000);
    await addEntry(ctx, auth, id, 'CASH_REPAYMENT', 2000);
    await ctx.http().post(`/customers/${id}/archive`).set(auth).expect(200);

    const again = await ctx.http().post('/customers').set(auth).send({ name: 'Sylvie Nana', phone: '690 12 12 12' }).expect(201);
    expect(again.body.id).toBe(id);
    expect(again.body.archivedAt).toBeNull();
    const detail = await ctx.http().get(`/customers/${id}`).set(auth).expect(200);
    expect(detail.body.history).toHaveLength(2);
  });

  it('isole les boutiques : on ne peut pas archiver le client d’une autre', async () => {
    const id = await addCustomer(ctx, auth, 'Client privé', '677 31 31 31');
    const other = await login(ctx, '655 00 11 22', 'Autre boutique');
    await ctx.http().post(`/customers/${id}/archive`).set(other).expect(404);
    await ctx.http().post(`/customers/${id}/unarchive`).set(other).expect(404);
    expect(await names()).toContain('Client privé');
  });
});
