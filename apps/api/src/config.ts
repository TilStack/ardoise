export interface AppConfig {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  publicPayUrl: string;
  paymentProvider: 'sandbox' | 'notchpay';
  webhookSecret: string;
  notchpay: { publicKey: string; privateKey?: string; webhookHeader: string };
  smsProvider: 'console';
  otpDevEcho: boolean;
  enableJobs: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export function loadConfig(): AppConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = required('JWT_SECRET');
  if (isProd && jwtSecret.length < 32) throw new Error('JWT_SECRET doit faire au moins 32 caractères en production');
  const paymentProvider = (process.env.PAYMENT_PROVIDER ?? 'sandbox') as AppConfig['paymentProvider'];
  if (isProd && paymentProvider === 'sandbox') throw new Error('PAYMENT_PROVIDER=sandbox interdit en production');
  const otpDevEcho = process.env.OTP_DEV_ECHO === 'true';
  if (isProd && otpDevEcho) throw new Error('OTP_DEV_ECHO interdit en production');

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
    smsProvider: 'console',
    otpDevEcho,
    enableJobs: process.env.ENABLE_JOBS === 'true',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
