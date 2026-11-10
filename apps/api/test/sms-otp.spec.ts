import { AfricasTalkingSmsSender, ConsoleSmsSender, SmsSender } from '../src/auth/auth';
import { loadConfig, parseTestNumbers } from '../src/config';
import { bootApp, TestCtx } from './helpers';

describe('Numéros de test à code fixe', () => {
  let ctx: TestCtx;
  let sms: ConsoleSmsSender;
  beforeAll(async () => {
    ctx = await bootApp();
    sms = ctx.app.get(SmsSender) as ConsoleSmsSender;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    sms.outbox.length = 0;
    await ctx.prisma.otpChallenge.deleteMany(); // évite le délai d'attente entre deux demandes
  });

  it('se connecte avec le code fixe et n’envoie aucun SMS', async () => {
    const phone = '+237677000555';
    await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    expect(sms.outbox).toHaveLength(0);
    const r = await ctx.http().post('/auth/otp/verify').send({ phone, code: '424242' }).expect(200);
    expect(r.body.token).toBeTruthy();
  });

  it('refuse un mauvais code sur un numéro de test', async () => {
    const phone = '+237677000555';
    await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    await ctx.http().post('/auth/otp/verify').send({ phone, code: '000000' }).expect(401);
  });

  it('le code fixe ne marche pas pour un autre numéro', async () => {
    const phone = '+237677000556';
    await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    expect(sms.outbox).toHaveLength(1);
    await ctx.http().post('/auth/otp/verify').send({ phone, code: '424242' }).expect(401);
  });
});

describe('Africa’s Talking', () => {
  const cfg = { username: 'ardoise', apiKey: 'cle', senderId: 'ARDOISE', baseUrl: 'https://at.test' };
  const reply = (statusCode: number, ok = true) =>
    (async () =>
      ({
        ok,
        status: ok ? 201 : 500,
        json: async () => ({ SMSMessageData: { Recipients: [{ statusCode, status: statusCode === 101 ? 'Success' : 'Échec' }] } }),
      }) as Response) as unknown as typeof fetch;

  it('envoie le message avec la clé en en-tête', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const impl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return { ok: true, status: 201, json: async () => ({ SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success' }] } }) };
    }) as unknown as typeof fetch;
    await new AfricasTalkingSmsSender(cfg, impl).send('+237677000001', 'code 123456');
    expect(seen!.url).toBe('https://at.test/version1/messaging');
    expect((seen!.init.headers as Record<string, string>).apiKey).toBe('cle');
    const body = String(seen!.init.body);
    expect(body).toContain('to=%2B237677000001');
    expect(body).toContain('from=ARDOISE');
  });

  it('lève une erreur si le fournisseur refuse', async () => {
    await expect(new AfricasTalkingSmsSender(cfg, reply(403)).send('+237677000001', 'x')).rejects.toThrow(/refusé/);
    await expect(new AfricasTalkingSmsSender(cfg, reply(101, false)).send('+237677000001', 'x')).rejects.toThrow(/HTTP/);
  });
});

describe('Configuration des SMS en production', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const prod = (extra: Record<string, string | undefined>) => {
    process.env = {
      ...saved,
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      PAYMENT_PROVIDER: 'notchpay',
      OTP_DEV_ECHO: undefined,
      OTP_TEST_NUMBERS: undefined,
      SMS_PROVIDER: undefined,
      ...extra,
    } as NodeJS.ProcessEnv;
  };

  it('refuse de démarrer sans aucun moyen d’envoyer les codes', () => {
    prod({});
    expect(() => loadConfig()).toThrow(/Aucun moyen d’envoyer/);
  });

  it('accepte des numéros de test seuls (phase de test fermé)', () => {
    prod({ OTP_TEST_NUMBERS: '+237677000555:424242' });
    expect(loadConfig().otpTestNumbers).toEqual({ '+237677000555': '424242' });
  });

  it('exige les identifiants Africa’s Talking', () => {
    prod({ SMS_PROVIDER: 'africastalking' });
    expect(() => loadConfig()).toThrow(/AT_USERNAME/);
    prod({ SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k' });
    expect(loadConfig().smsProvider).toBe('africastalking');
  });

  it('refuse les secrets d’exemple publiés dans le dépôt', () => {
    prod({ OTP_TEST_NUMBERS: '+237677000555:424242', JWT_SECRET: 'change-me-in-production-please-123456' });
    expect(() => loadConfig()).toThrow(/valeur d’exemple/);
    prod({ OTP_TEST_NUMBERS: '+237677000555:424242', WEBHOOK_SECRET: 'dev-webhook-secret' });
    expect(() => loadConfig()).toThrow(/WEBHOOK_SECRET/);
  });

  it('rejette une liste de numéros de test mal formée', () => {
    expect(() => parseTestNumbers('0677000555:12')).toThrow(/invalide/);
    expect(parseTestNumbers('')).toEqual({});
  });
});
