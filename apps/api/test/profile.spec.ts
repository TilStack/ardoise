import { renderMessage, DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_PERSONAL } from '../src/reminders/rules';
import { bootApp, TestCtx } from './helpers';

describe('Profil Commerçant / Particulier', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await bootApp();
  });
  afterAll(() => ctx.app.close());

  /** Connexion sans choisir de profil, comme un tout nouvel utilisateur. */
  async function freshLogin(phone: string) {
    const r1 = await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    const r2 = await ctx.http().post('/auth/otp/verify').send({ phone, code: r1.body.devCode }).expect(200);
    return { auth: { Authorization: `Bearer ${r2.body.token}` }, merchant: r2.body.merchant };
  }

  it('un nouvel utilisateur n’a pas encore de profil : l’app doit le lui demander', async () => {
    const { merchant } = await freshLogin('677 20 20 20');
    expect(merchant.profileType).toBeNull();
  });

  it('choisit le profil Particulier avec son prénom, et le retrouve ensuite', async () => {
    const { auth } = await freshLogin('677 21 21 21');
    await ctx.http().patch('/me').set(auth).send({ profileType: 'PERSONAL', shopName: 'Brice' }).expect(200);
    const me = await ctx.http().get('/me').set(auth).expect(200);
    expect(me.body).toMatchObject({ profileType: 'PERSONAL', shopName: 'Brice' });
  });

  it('refuse un profil inconnu', async () => {
    const { auth } = await freshLogin('677 22 22 22');
    await ctx.http().patch('/me').set(auth).send({ profileType: 'ADMIN' }).expect(400);
  });

  it('le message de relance par défaut d’un particulier est adapté (sans « boutique »)', async () => {
    const { auth } = await freshLogin('677 23 23 23');
    await ctx.http().patch('/me').set(auth).send({ profileType: 'PERSONAL', shopName: 'Brice' }).expect(200);
    const r = await ctx.http().get('/reminders').set(auth).expect(200);
    expect(r.body.settings.defaultTemplate).toBe(DEFAULT_TEMPLATE_PERSONAL);
    expect(r.body.settings.template).toBe(DEFAULT_TEMPLATE_PERSONAL);
    expect(r.body.settings.defaultTemplate).not.toMatch(/boutique/i);
  });

  it('un commerçant garde le message d’origine', async () => {
    const { auth } = await freshLogin('677 24 24 24');
    await ctx.http().patch('/me').set(auth).send({ profileType: 'MERCHANT', shopName: 'Boutique Brigitte' }).expect(200);
    const r = await ctx.http().get('/reminders').set(auth).expect(200);
    expect(r.body.settings.defaultTemplate).toBe(DEFAULT_TEMPLATE);
  });

  it('rend le message d’un particulier avec le prénom, le montant et le lien', () => {
    const m = renderMessage(null, { name: 'Paul Ngono', amount: 12500, shop: 'Brice', url: 'https://pay.test/p/abc', profile: 'PERSONAL' });
    expect(m).toMatch(/^Bonjour Paul, petit rappel : tu me dois encore 12 500 FCFA\./);
    expect(m).toContain('https://pay.test/p/abc');
    expect(m).not.toMatch(/boutique/i);
  });
});
