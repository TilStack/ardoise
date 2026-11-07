import { describe, expect, it, vi } from 'vitest';
import {
  canTransition,
  detectOperator,
  hmacSha256Hex,
  isFinal,
  mapNotchPayStatus,
  maskPhone,
  normalizeCmPhone,
  NotchPayProvider,
  ProviderError,
  SandboxProvider,
} from '../src';

describe('machine à états', () => {
  it('autorise le chemin nominal et interdit de quitter un statut final', () => {
    expect(canTransition('CREATED', 'PENDING')).toBe(true);
    expect(canTransition('PENDING', 'SUCCESS')).toBe(true);
    expect(canTransition('SUCCESS', 'FAILED')).toBe(false);
    expect(canTransition('EXPIRED', 'SUCCESS')).toBe(false);
    expect(canTransition('PENDING', 'PENDING')).toBe(false);
    expect(isFinal('FAILED')).toBe(true);
    expect(isFinal('PENDING')).toBe(false);
  });
});

describe('numéros camerounais', () => {
  it.each([
    ['677 12 34 56', '+237677123456'],
    ['+237 6 77 12 34 56', '+237677123456'],
    ['00237677123456', '+237677123456'],
    ['237699000111', '+237699000111'],
  ])('normalise %s', (input, out) => expect(normalizeCmPhone(input)).toBe(out));

  it('rejette les numéros invalides', () => {
    expect(() => normalizeCmPhone('2 33 44 55')).toThrow();
    expect(() => normalizeCmPhone('+33612345678')).toThrow();
  });

  it('détecte l’opérateur et masque le numéro', () => {
    expect(detectOperator('677123456')).toBe('MTN');
    expect(detectOperator('691234567')).toBe('ORANGE');
    expect(detectOperator('656000000')).toBe('ORANGE');
    expect(detectOperator('662000000')).toBeNull();
    expect(maskPhone('677123456')).toBe('+237 6 77 •• •• 56');
  });
});

describe('NotchPay', () => {
  const secret = 'whsec_test';

  function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift()!;
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('initialise puis déclenche le débit sur le bon canal', async () => {
    const { impl, calls } = fakeFetch([
      { status: 201, body: { transaction: { reference: 'trx.abc', status: 'pending' } } },
      { status: 202, body: { transaction: { reference: 'trx.abc', status: 'processing' } } },
    ]);
    const p = new NotchPayProvider({ publicKey: 'pk_test', webhookSecret: secret, fetchImpl: impl });
    const r = await p.initiate({
      reference: 'ARD-tx1', amount: 12500, currency: 'XAF', phone: '+237677123456', operator: 'MTN', description: 'Dette',
    });
    expect(r).toMatchObject({ providerRef: 'trx.abc', status: 'PENDING' });
    expect(calls[0].url).toBe('https://api.notchpay.co/payments/initialize');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('pk_test');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ reference: 'ARD-tx1', amount: 12500, currency: 'XAF' });
    expect(calls[1].init.method).toBe('PUT');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ channel: 'cm.mtn', data: { phone: '+237677123456' } });
  });

  it('remonte une ProviderError avec le statut HTTP', async () => {
    const { impl } = fakeFetch([{ status: 422, body: { message: 'Invalid phone' } }]);
    const p = new NotchPayProvider({ publicKey: 'pk', webhookSecret: secret, fetchImpl: impl });
    await expect(
      p.initiate({ reference: 'r', amount: 100, currency: 'XAF', phone: '+237677123456', operator: 'ORANGE', description: 'x' }),
    ).rejects.toMatchObject({ name: 'ProviderError', httpStatus: 422 });
  });

  it('lit le statut et le montant', async () => {
    const { impl } = fakeFetch([{ status: 200, body: { transaction: { reference: 'trx.abc', status: 'complete', amount: '12500', currency: 'XAF' } } }]);
    const p = new NotchPayProvider({ publicKey: 'pk', webhookSecret: secret, fetchImpl: impl });
    expect(await p.getStatus('trx.abc')).toMatchObject({ status: 'SUCCESS', amount: 12500, currency: 'XAF' });
  });

  it('mappe les statuts de façon prudente', () => {
    expect(mapNotchPayStatus('complete')).toBe('SUCCESS');
    expect(mapNotchPayStatus('canceled')).toBe('EXPIRED');
    expect(mapNotchPayStatus('failed')).toBe('FAILED');
    expect(mapNotchPayStatus('quelque-chose')).toBe('PENDING');
    expect(mapNotchPayStatus(undefined)).toBe('PENDING');
  });

  it('vérifie la signature du webhook sur le corps brut', () => {
    const p = new NotchPayProvider({ publicKey: 'pk', webhookSecret: secret });
    const body = JSON.stringify({ event: 'payment.complete', data: { reference: 'trx.abc', status: 'complete' } });
    expect(p.verifyWebhook(body, { 'X-Notch-Signature': hmacSha256Hex(secret, body) })).toBe(true);
    expect(p.verifyWebhook(body, { 'x-notch-signature': hmacSha256Hex('autre', body) })).toBe(false);
    expect(p.verifyWebhook(body + ' ', { 'x-notch-signature': hmacSha256Hex(secret, body) })).toBe(false);
    expect(p.verifyWebhook(body, {})).toBe(false);
    expect(p.parseWebhook(body)).toMatchObject({ providerRef: 'trx.abc', announcedStatus: 'SUCCESS' });
  });
});

describe('Sandbox', () => {
  const base = { amount: 5000, currency: 'XAF' as const, operator: 'MTN' as const, description: 'test' };

  it('simule un paiement complet avec webhook signé', async () => {
    const p = new SandboxProvider('s3cret');
    const r = await p.initiate({ ...base, reference: 'ref1', phone: '+237677123456' });
    expect(r.status).toBe('PENDING');
    const wh = p.simulate(r.providerRef, 'SUCCESS');
    expect(p.verifyWebhook(wh.body, wh.headers)).toBe(true);
    expect(p.parseWebhook(wh.body)).toMatchObject({ providerRef: r.providerRef, merchantReference: 'ref1' });
    expect((await p.getStatus(r.providerRef)).status).toBe('SUCCESS');
  });

  it('est idempotente sur la référence et simule refus et panne', async () => {
    const p = new SandboxProvider('s');
    const a = await p.initiate({ ...base, reference: 'same', phone: '+237677123456' });
    const b = await p.initiate({ ...base, reference: 'same', phone: '+237677123456' });
    expect(a.providerRef).toBe(b.providerRef);
    expect((await p.initiate({ ...base, reference: 'ko', phone: '+237677120000' })).status).toBe('FAILED');
    await expect(p.initiate({ ...base, reference: 'down', phone: '+237677129999' })).rejects.toBeInstanceOf(ProviderError);
  });
});
