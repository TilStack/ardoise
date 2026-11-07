import { BadRequestException, GoneException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  canTransition,
  isFinal,
  normalizeCmPhone,
  Operator,
  PaymentProvider,
  ProviderError,
  randomToken,
  RECOVERY_AFTER_MS,
  StatusResult,
} from '@ardoise/pay-core';
import { APP_CONFIG, AppConfig } from '../config';
import { Prisma, Transaction } from '../generated/prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const MIN_PAYMENT = 100;
export const LINK_TTL_DAYS = 30;
/** Au-delà, une transaction encore « en attente » chez le fournisseur est signalée pour revue humaine. */
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------------- Liens de paiement ----------------

  async createLink(merchantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, merchantId } });
    if (!customer) throw new NotFoundException('Client introuvable');
    const token = randomToken(18); // 144 bits
    const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000);
    const link = await this.prisma.paymentLink.create({ data: { merchantId, customerId, tokenHash: hashToken(token), expiresAt } });
    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    const balance = await this.ledger.balanceOf(customerId);
    const url = `${this.cfg.publicPayUrl}/${token}`;
    const shop = merchant.shopName ?? 'votre boutique';
    const firstName = customer.name.split(' ')[0];
    return {
      url,
      token,
      linkId: link.id,
      expiresAt,
      balance,
      message:
        `Bonjour ${firstName}, vous devez ${fcfa(balance)} à ${shop}. ` +
        `Payez en 1 clic, même une partie : ${url}`,
    };
  }

  async resolveLink(token: string) {
    const link = await this.prisma.paymentLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { customer: true, merchant: true },
    });
    if (!link) throw new NotFoundException('Lien inconnu');
    if (link.revokedAt || link.expiresAt < new Date()) throw new GoneException('Ce lien a expiré : demandez-en un nouveau à la boutique');
    return link;
  }

  /** Données affichées sur la page de paiement publique (aucune donnée sensible). */
  async publicView(token: string) {
    const link = await this.resolveLink(token);
    const [balance, recent] = await Promise.all([
      this.ledger.balanceOf(link.customerId),
      this.prisma.ledgerEntry.findMany({
        where: { customerId: link.customerId, type: { in: ['DEBT', 'CASH_REPAYMENT', 'MOBILE_PAYMENT'] }, reversedBy: null },
        orderBy: { occurredAt: 'desc' },
        take: 5,
      }),
    ]);
    return {
      shopName: link.merchant.shopName ?? 'Boutique',
      customerFirstName: link.customer.name.split(' ')[0],
      balance,
      minAmount: MIN_PAYMENT,
      suggestedOperator: link.customer.operator,
      recent: recent.map((e) => ({ type: e.type, amount: e.amount, label: e.label, occurredAt: e.occurredAt })),
    };
  }

  // ---------------- Initiation ----------------

  async initiate(token: string, input: { amount: number; phone: string; operator: Operator }) {
    const link = await this.resolveLink(token);
    const balance = await this.ledger.balanceOf(link.customerId);
    if (balance <= 0) throw new BadRequestException('Rien à payer : votre solde est à jour');
    if (!Number.isInteger(input.amount) || input.amount < MIN_PAYMENT) {
      throw new BadRequestException(`Montant minimum : ${fcfa(MIN_PAYMENT)}`);
    }
    if (input.amount > balance) throw new BadRequestException(`Montant maximum : ${fcfa(balance)} (votre solde)`);
    let phone: string;
    try {
      phone = normalizeCmPhone(input.phone);
    } catch {
      throw new BadRequestException('Numéro Mobile Money invalide');
    }

    const tx = await this.prisma.transaction.create({
      data: {
        reference: `ARD-${randomUUID()}`,
        merchantId: link.merchantId,
        customerId: link.customerId,
        paymentLinkId: link.id,
        provider: this.provider.name,
        amount: input.amount,
        phone,
        operator: input.operator,
        status: 'CREATED',
      },
    });

    try {
      const r = await this.provider.initiate({
        reference: tx.reference,
        amount: tx.amount,
        currency: 'XAF',
        phone,
        operator: input.operator,
        description: `${link.merchant.shopName ?? "L'Ardoise"} — remboursement`,
        customerName: link.customer.name,
      });
      await this.event('INITIATE', { providerRef: r.providerRef, transactionId: tx.id, payload: r.raw });
      const status = r.status === 'SUCCESS' ? 'PENDING' : r.status; // un succès se confirme toujours via getStatus
      const updated = await this.prisma.transaction.update({
        where: { id: tx.id },
        data: {
          providerRef: r.providerRef,
          status,
          ...(status === 'FAILED' ? { failureReason: 'Refusé par l’opérateur', finalizedAt: new Date() } : {}),
        },
      });
      return this.publicTx(updated);
    } catch (e) {
      if (e instanceof ProviderError) {
        await this.event('INITIATE', { transactionId: tx.id, payload: { error: e.message, details: e.details ?? null } });
        // 4xx = refus certain ; sinon (timeout, 5xx) le résultat est inconnu : on laisse la tâche de rattrapage trancher.
        const certain = e.httpStatus !== undefined && e.httpStatus >= 400 && e.httpStatus < 500;
        const updated = await this.prisma.transaction.update({
          where: { id: tx.id },
          data: certain
            ? { status: 'FAILED', failureReason: e.message, finalizedAt: new Date() }
            : { status: 'PENDING', failureReason: e.message },
        });
        if (!certain) this.log.warn(`Initiation incertaine ${tx.reference} : ${e.message}`);
        return this.publicTx(updated);
      }
      throw e;
    }
  }

  async publicStatus(token: string, txId: string) {
    const link = await this.resolveLink(token);
    const tx = await this.prisma.transaction.findFirst({ where: { id: txId, paymentLinkId: link.id }, include: { entry: { include: { receipt: true } } } });
    if (!tx) throw new NotFoundException('Paiement introuvable');
    return {
      ...this.publicTx(tx),
      receipt: tx.entry?.receipt
        ? { number: receiptNumber(tx.entry.receipt.number, tx.entry.receipt.createdAt), balanceAfter: tx.entry.receipt.balanceAfter }
        : null,
    };
  }

  private publicTx(tx: Transaction) {
    return { id: tx.id, status: tx.status, amount: tx.amount, operator: tx.operator, createdAt: tx.createdAt };
  }

  // ---------------- Confirmation (webhook + rattrapage) ----------------

  /** Webhook : signature vérifiée, archive brute, puis relecture du statut chez le fournisseur. */
  async handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const signatureOk = this.provider.verifyWebhook(rawBody, headers);
    let payload: Prisma.InputJsonValue;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      payload = { raw: rawBody.toString().slice(0, 10_000) };
    }
    if (!signatureOk) {
      await this.event('WEBHOOK', { signatureOk: false, payload });
      return { accepted: false as const };
    }
    const evt = this.provider.parseWebhook(rawBody);
    const tx = await this.prisma.transaction.findFirst({
      where: {
        provider: this.provider.name,
        OR: [{ providerRef: evt.providerRef }, ...(evt.merchantReference ? [{ reference: evt.merchantReference }] : [])],
      },
    });
    await this.event('WEBHOOK', { signatureOk: true, providerRef: evt.providerRef, transactionId: tx?.id, payload });
    if (!tx) {
      this.log.warn(`Webhook pour une transaction inconnue : ${evt.providerRef}`);
      return { accepted: true as const, known: false };
    }
    await this.refresh(tx.id);
    return { accepted: true as const, known: true };
  }

  /** Relit le statut chez le fournisseur et l'applique. Idempotent, sûr à appeler plusieurs fois. */
  async refresh(txId: string) {
    const tx = await this.prisma.transaction.findUniqueOrThrow({ where: { id: txId } });
    if (isFinal(tx.status) || !tx.providerRef) return tx;
    let status: StatusResult;
    try {
      status = await this.provider.getStatus(tx.providerRef);
    } catch (e) {
      this.log.warn(`Lecture du statut impossible pour ${tx.reference} : ${(e as Error).message}`);
      await this.prisma.transaction.update({ where: { id: tx.id }, data: { lastPolledAt: new Date() } });
      return tx;
    }
    await this.event('STATUS_POLL', { providerRef: tx.providerRef, transactionId: tx.id, payload: status.raw as Prisma.InputJsonValue });
    return this.apply(tx.id, status);
  }

  /**
   * Applique un statut fournisseur. Verrou de ligne + contrainte d'unicité sur ledger_entries.transaction_id :
   * même si deux webhooks et la tâche de rattrapage arrivent en même temps, le client n'est crédité qu'une fois.
   */
  async apply(txId: string, s: StatusResult) {
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM transactions WHERE id = ${txId}::uuid FOR UPDATE`;
      const tx = await db.transaction.findUniqueOrThrow({ where: { id: txId } });
      const now = new Date();
      if (isFinal(tx.status)) return tx;

      if (s.status === 'PENDING') {
        const stuck = now.getTime() - tx.createdAt.getTime() > STUCK_AFTER_MS;
        return db.transaction.update({ where: { id: tx.id }, data: { lastPolledAt: now, ...(stuck ? { reviewRequired: true } : {}) } });
      }
      if (!canTransition(tx.status, s.status)) return tx;

      if (s.status === 'SUCCESS') {
        if (s.currency !== 'XAF' || !Number.isInteger(s.amount) || s.amount <= 0) {
          this.log.error(`Confirmation incohérente pour ${tx.reference} : ${s.amount} ${s.currency}`);
          return db.transaction.update({
            where: { id: tx.id },
            data: { reviewRequired: true, lastPolledAt: now, failureReason: `Montant/devise incohérents : ${s.amount} ${s.currency}` },
          });
        }
        // On crédite ce que l'opérateur a réellement encaissé ; un écart est signalé pour revue.
        const mismatch = s.amount !== tx.amount;
        const entry = await this.ledger.post(
          {
            merchantId: tx.merchantId,
            customerId: tx.customerId,
            type: 'MOBILE_PAYMENT',
            amount: s.amount,
            label: `Paiement ${tx.operator === 'MTN' ? 'MTN MoMo' : 'Orange Money'}`,
            transactionId: tx.id,
            occurredAt: now,
          },
          db,
        );
        const balanceAfter = await this.ledger.balanceOf(tx.customerId, db);
        await db.receipt.create({
          data: { entryId: entry.id, merchantId: tx.merchantId, customerId: tx.customerId, amount: s.amount, balanceAfter },
        });
        return db.transaction.update({
          where: { id: tx.id },
          data: { status: 'SUCCESS', confirmedAmount: s.amount, finalizedAt: now, lastPolledAt: now, reviewRequired: mismatch || tx.reviewRequired },
        });
      }

      return db.transaction.update({
        where: { id: tx.id },
        data: { status: s.status, finalizedAt: now, lastPolledAt: now, failureReason: s.status === 'FAILED' ? 'Refusé ou annulé' : 'Expiré' },
      });
    });
  }

  /** Tâche de rattrapage : webhooks perdus. Relit les transactions en attente depuis plus de 5 min. */
  async recoverStale(now = new Date(), limit = 100) {
    const before = new Date(now.getTime() - RECOVERY_AFTER_MS);
    const stale = await this.prisma.transaction.findMany({
      where: {
        status: { in: ['CREATED', 'PENDING'] },
        providerRef: { not: null },
        createdAt: { lt: before },
        OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(now.getTime() - 2 * 60_000) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    for (const tx of stale) await this.refresh(tx.id);
    // Transactions sans référence fournisseur (initiation jamais aboutie) : expirées après 1 h.
    const orphan = await this.prisma.transaction.updateMany({
      where: { status: { in: ['CREATED', 'PENDING'] }, providerRef: null, createdAt: { lt: new Date(now.getTime() - 3_600_000) } },
      data: { status: 'EXPIRED', finalizedAt: now, failureReason: 'Initiation non aboutie' },
    });
    return { checked: stale.length, orphansExpired: orphan.count };
  }

  private event(
    kind: 'INITIATE' | 'WEBHOOK' | 'STATUS_POLL',
    e: { providerRef?: string; transactionId?: string; signatureOk?: boolean; payload: unknown },
  ) {
    return this.prisma.providerEvent.create({
      data: {
        provider: this.provider.name,
        kind,
        providerRef: e.providerRef ?? null,
        transactionId: e.transactionId ?? null,
        signatureOk: e.signatureOk ?? null,
        payload: (e.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}

export function fcfa(n: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(n).replace(/ | /g, ' ')} FCFA`;
}

export function receiptNumber(n: number, at: Date): string {
  return `ARD-${at.getUTCFullYear()}-${String(n).padStart(4, '0')}`;
}
