import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function hmacSha256Hex(secret: string, payload: Buffer | string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Comparaison à temps constant de deux signatures hexadécimales. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Jeton aléatoire URL-safe (≥ 128 bits par défaut). */
export function randomToken(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}
