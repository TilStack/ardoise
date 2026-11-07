import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SandboxProvider } from '@ardoise/pay-core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/payments/payments.service';

export interface TestCtx {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  payments: PaymentsService;
  sandbox: SandboxProvider;
}

export async function bootApp(): Promise<TestCtx> {
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true, logger: ['error'] }));
  await app.init();
  const prisma = app.get(PrismaService);
  await resetDb(prisma);
  const payments = app.get(PaymentsService);
  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma,
    payments,
    sandbox: payments.provider as SandboxProvider,
  };
}

export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE reminders, receipts, provider_events, ledger_lines, ledger_entries, transactions, payment_links, customers, otp_challenges, merchants RESTART IDENTITY CASCADE',
  );
}

/** Connexion complète par OTP ; renvoie l'en-tête Authorization. */
export async function login(ctx: TestCtx, phone: string, shopName = 'Boutique Brigitte') {
  const r1 = await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
  const r2 = await ctx.http().post('/auth/otp/verify').send({ phone, code: r1.body.devCode }).expect(200);
  const auth = { Authorization: `Bearer ${r2.body.token}` };
  await ctx.http().patch('/me').set(auth).send({ shopName }).expect(200);
  return auth;
}

export async function addCustomer(ctx: TestCtx, auth: Record<string, string>, name: string, phone: string) {
  const r = await ctx.http().post('/customers').set(auth).send({ name, phone }).expect(201);
  return r.body.id as string;
}

export async function addEntry(
  ctx: TestCtx,
  auth: Record<string, string>,
  customerId: string,
  type: 'DEBT' | 'CASH_REPAYMENT',
  amount: number,
  extra: Record<string, unknown> = {},
) {
  const r = await ctx
    .http()
    .post('/entries')
    .set(auth)
    .send({ clientUuid: randomUUID(), customerId, type, amount, ...extra })
    .expect(201);
  return r.body;
}

/** Livre un webhook sandbox signé à l'API, comme le ferait le fournisseur. */
export function deliverWebhook(ctx: TestCtx, wh: { body: string; headers: Record<string, string> }) {
  return ctx.http().post('/webhooks/payments').set({ 'Content-Type': 'application/json', ...wh.headers }).send(wh.body);
}
