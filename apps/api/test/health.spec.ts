import { bootApp, TestCtx } from './helpers';

describe('Santé', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await bootApp();
  });
  afterAll(() => ctx.app.close());

  it('/health vérifie aussi la base', async () => {
    const r = await ctx.http().get('/health').expect(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('/health/ping répond sans interroger la base', async () => {
    const spy = jest.spyOn(ctx.prisma, '$queryRaw');
    const r = await ctx.http().get('/health/ping').expect(200);
    expect(r.body).toEqual({ status: 'ok' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
