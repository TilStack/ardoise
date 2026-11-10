export interface AppConfig {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  publicPayUrl: string;
  paymentProvider: 'sandbox' | 'notchpay';
  webhookSecret: string;
  notchpay: { publicKey: string; privateKey?: string; webhookHeader: string };
  smsProvider: 'console' | 'africastalking';
  africasTalking: { username: string; apiKey: string; senderId?: string; baseUrl: string };
  /** Numéros de test : connexion avec un code fixe, sans SMS (phase de test fermé, relecture Google). */
  otpTestNumbers: Record<string, string>;
  otpDevEcho: boolean;
  enableJobs: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

/** « +237600000001:123456,+237600000002:654321 » → { '+237600000001': '123456', … } */
export function parseTestNumbers(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [phone, code] = part.split(':').map((s) => s.trim());
    if (!/^\+237\d{9}$/.test(phone ?? '') || !/^\d{6}$/.test(code ?? '')) {
      throw new Error(`OTP_TEST_NUMBERS : entrée invalide « ${part} » (attendu +237XXXXXXXXX:123456)`);
    }
    out[phone] = code;
  }
  return out;
}

export function loadConfig(): AppConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = required('JWT_SECRET');
  if (isProd && jwtSecret.length < 32) throw new Error('JWT_SECRET doit faire au moins 32 caractères en production');
  // Les valeurs d'exemple sont publiques (dépôt public) : jamais en production.
  if (isProd && /^(change-me|dev-|test-secret)/i.test(jwtSecret)) {
    throw new Error('JWT_SECRET ressemble à une valeur d’exemple : générer un secret aléatoire pour la production');
  }
  if (isProd && /^(dev-|test-)/i.test(process.env.WEBHOOK_SECRET ?? '')) {
    throw new Error('WEBHOOK_SECRET ressemble à une valeur d’exemple : utiliser le secret du webhook NotchPay de production');
  }
  const paymentProvider = (process.env.PAYMENT_PROVIDER ?? 'sandbox') as AppConfig['paymentProvider'];
  if (isProd && paymentProvider === 'sandbox') throw new Error('PAYMENT_PROVIDER=sandbox interdit en production');
  const otpDevEcho = process.env.OTP_DEV_ECHO === 'true';
  if (isProd && otpDevEcho) throw new Error('OTP_DEV_ECHO interdit en production');

  const smsProvider = (process.env.SMS_PROVIDER ?? 'console') as AppConfig['smsProvider'];
  if (smsProvider !== 'console' && smsProvider !== 'africastalking') {
    throw new Error(`SMS_PROVIDER inconnu : ${smsProvider} (console | africastalking)`);
  }
  const otpTestNumbers = parseTestNumbers(process.env.OTP_TEST_NUMBERS);
  if (isProd && smsProvider === 'console' && Object.keys(otpTestNumbers).length === 0) {
    throw new Error(
      'Aucun moyen d’envoyer les codes de connexion en production : définir SMS_PROVIDER=africastalking ou OTP_TEST_NUMBERS',
    );
  }
  if (smsProvider === 'africastalking') {
    required('AT_USERNAME');
    required('AT_API_KEY');
  }

  return {
    databaseUrl: required('DATABASE_URL'),
    port: Number(process.env.PORT ?? 3000),
    jwtSecret,
    publicPayUrl: (process.env.PUBLIC_PAY_URL ?? 'http://localhost:3000/p').replace(/\/$/, ''),
    paymentProvider,
    webhookSecret: required('WEBHOOK_SECRET'),
    notchpay: {
      publicKey: process.env.NOTCHPAY_PUBLIC_KEY ?? '',
      privateKey: process.env.NOTCHPAY_PRIVATE_KEY || undefined,
      webhookHeader: process.env.NOTCHPAY_WEBHOOK_HEADER ?? 'x-notch-signature',
    },
    smsProvider,
    africasTalking: {
      username: process.env.AT_USERNAME ?? '',
      apiKey: process.env.AT_API_KEY ?? '',
      senderId: process.env.AT_SENDER_ID || undefined,
      baseUrl: process.env.AT_BASE_URL ?? 'https://api.africastalking.com',
    },
    otpTestNumbers,
    otpDevEcho,
    enableJobs: process.env.ENABLE_JOBS === 'true',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
