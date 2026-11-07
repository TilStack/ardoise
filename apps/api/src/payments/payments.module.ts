import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { NotchPayProvider, PaymentProvider, SandboxProvider } from '@ardoise/pay-core';
import { APP_CONFIG, AppConfig } from '../config';
import { AuthModule, JwtGuard, MerchantId } from '../auth/auth';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER, PaymentsService, receiptNumber } from './payments.service';

class PayDto {
  @IsInt() @Min(1) @Max(10_000_000) amount: number;
  @IsString() phone: string;
  @IsIn(['MTN', 'ORANGE']) operator: 'MTN' | 'ORANGE';
}

// ---------- Côté boutique ----------

@UseGuards(JwtGuard)
@Controller()
export class MerchantPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('customers/:id/payment-link')
  createLink(@MerchantId() merchantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.createLink(merchantId, id);
  }

  @Get('transactions')
  list(@MerchantId() merchantId: string, @Query('status') status?: string) {
    const allowed = ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'];
    if (status && !allowed.includes(status)) throw new BadRequestException('Statut inconnu');
    return this.prisma.transaction.findMany({
      where: { merchantId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, amount: true, status: true, operator: true, createdAt: true, reviewRequired: true, customer: { select: { name: true } } },
    });
  }

  @Get('receipts/:number')
  async receipt(@MerchantId() merchantId: string, @Param('number', ParseIntPipe) n: number) {
    const r = await this.prisma.receipt.findFirst({
      where: { number: n, merchantId },
      include: { customer: true, merchant: true, entry: { include: { transaction: true } } },
    });
    if (!r) throw new NotFoundException('Reçu introuvable');
    return {
      number: receiptNumber(r.number, r.createdAt),
      shopName: r.merchant.shopName,
      customerName: r.customer.name,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      method: r.entry.transaction ? `${r.entry.transaction.operator === 'MTN' ? 'MTN MoMo' : 'Orange Money'}` : 'Espèces',
      providerRef: r.entry.transaction?.providerRef ?? null,
      date: r.createdAt,
    };
  }
}

// ---------- Page de paiement publique (client, sans compte) ----------

@Controller('public/links')
export class PublicPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.payments.publicView(token);
  }

  @Post(':token/payments')
  pay(@Param('token') token: string, @Body() dto: PayDto) {
    return this.payments.initiate(token, dto);
  }

  @Get(':token/payments/:txId')
  status(@Param('token') token: string, @Param('txId', ParseUUIDPipe) txId: string) {
    return this.payments.publicStatus(token, txId);
  }
}

// ---------- Webhooks fournisseur ----------

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /** Répond vite : signature + archive + relecture du statut (une seule transaction SQL courte). */
  @Post('payments')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string>) {
    if (!req.rawBody) throw new BadRequestException('Corps manquant');
    const r = await this.payments.handleWebhook(req.rawBody, headers);
    if (!r.accepted) throw new UnauthorizedException('Signature invalide');
    return { ok: true };
  }
}

// ---------- Outils de développement (fournisseur sandbox uniquement) ----------

@Controller('dev/sandbox')
export class SandboxController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Simule la décision du client sur son téléphone, puis livre le webhook signé à l'API. */
  @Post(':txId/:outcome')
  @HttpCode(200)
  async simulate(@Param('txId', ParseUUIDPipe) txId: string, @Param('outcome') outcome: string) {
    const provider = this.payments.provider;
    if (!(provider instanceof SandboxProvider)) throw new ForbiddenException('Disponible uniquement avec PAYMENT_PROVIDER=sandbox');
    const map: Record<string, 'SUCCESS' | 'FAILED' | 'EXPIRED'> = { success: 'SUCCESS', fail: 'FAILED', expire: 'EXPIRED' };
    if (!map[outcome]) throw new BadRequestException('Issue attendue : success | fail | expire');
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx?.providerRef) throw new NotFoundException('Transaction inconnue');
    const wh = provider.simulate(tx.providerRef, map[outcome]);
    await this.payments.handleWebhook(Buffer.from(wh.body), wh.headers);
    return this.prisma.transaction.findUnique({ where: { id: txId } });
  }
}

// ---------- Tâche de rattrapage ----------

@Injectable()
export class RecoveryJob {
  private readonly log = new Logger('RecoveryJob');
  private running = false;
  constructor(
    private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Interval(60_000)
  async tick() {
    if (!this.cfg.enableJobs || this.running) return;
    this.running = true;
    try {
      const r = await this.payments.recoverStale();
      if (r.checked || r.orphansExpired) this.log.log(`Rattrapage : ${r.checked} relues, ${r.orphansExpired} orphelines expirées`);
    } catch (e) {
      this.log.error(`Rattrapage en échec : ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

export function providerFactory(cfg: AppConfig): PaymentProvider {
  if (cfg.paymentProvider === 'notchpay') {
    return new NotchPayProvider({
      publicKey: cfg.notchpay.publicKey,
      privateKey: cfg.notchpay.privateKey,
      webhookSecret: cfg.webhookSecret,
      webhookSignatureHeader: cfg.notchpay.webhookHeader,
    });
  }
  return new SandboxProvider(cfg.webhookSecret);
}

@Module({
  imports: [AuthModule],
  controllers: [MerchantPaymentsController, PublicPaymentsController, WebhooksController, SandboxController],
  providers: [
    PaymentsService,
    LedgerService,
    RecoveryJob,
    { provide: PAYMENT_PROVIDER, inject: [APP_CONFIG], useFactory: providerFactory },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
