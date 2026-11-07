import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Direction, EntryType, Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';

/**
 * Plan de comptes (par boutique / par client) :
 *   recv:{customerId}    créance client            (débit = le client doit plus)
 *   sales:{merchantId}   ventes à crédit
 *   cash:{merchantId}    caisse espèces
 *   transit:{merchantId} fonds encaissés chez l'agrégateur, pas encore reversés
 */
export const acc = {
  receivable: (customerId: string) => `recv:${customerId}`,
  sales: (merchantId: string) => `sales:${merchantId}`,
  cash: (merchantId: string) => `cash:${merchantId}`,
  transit: (merchantId: string) => `transit:${merchantId}`,
};

export interface LineInput {
  account: string;
  amount: number;
  direction: Direction;
}

export interface PostEntryInput {
  merchantId: string;
  customerId: string;
  type: EntryType;
  amount: number;
  label?: string | null;
  clientUuid?: string | null;
  reversesId?: string | null;
  transactionId?: string | null;
  createdBy?: string | null;
  occurredAt?: Date;
}

export const MAX_AMOUNT = 10_000_000; // 10 M FCFA par écriture : garde-fou contre les fautes de frappe

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lignes d'une écriture selon son type métier. */
  linesFor(type: EntryType, amount: number, merchantId: string, customerId: string): LineInput[] {
    const recv = acc.receivable(customerId);
    switch (type) {
      case 'DEBT':
        return [
          { account: recv, amount, direction: 'DEBIT' },
          { account: acc.sales(merchantId), amount, direction: 'CREDIT' },
        ];
      case 'CASH_REPAYMENT':
        return [
          { account: acc.cash(merchantId), amount, direction: 'DEBIT' },
          { account: recv, amount, direction: 'CREDIT' },
        ];
      case 'MOBILE_PAYMENT':
        return [
          { account: acc.transit(merchantId), amount, direction: 'DEBIT' },
          { account: recv, amount, direction: 'CREDIT' },
        ];
      case 'REVERSAL':
        throw new Error('Les lignes d’une annulation se déduisent de l’écriture annulée');
    }
  }

  static assertBalanced(lines: LineInput[]) {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      if (!Number.isInteger(l.amount) || l.amount <= 0) throw new Error(`Ligne invalide : ${l.amount}`);
      if (l.direction === 'DEBIT') debit += l.amount;
      else credit += l.amount;
    }
    if (debit !== credit) throw new Error(`Écriture déséquilibrée : débit ${debit} ≠ crédit ${credit}`);
  }

  /** Enregistre une écriture équilibrée. À appeler dans une transaction pour les flux composés. */
  async post(input: PostEntryInput, db: Tx = this.prisma) {
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT) {
      throw new BadRequestException(`Montant invalide (entier entre 1 et ${MAX_AMOUNT} FCFA)`);
    }
    let lines: LineInput[];
    if (input.type === 'REVERSAL') {
      if (!input.reversesId) throw new BadRequestException('Une annulation doit référencer une écriture');
      const original = await db.ledgerEntry.findUnique({ where: { id: input.reversesId }, include: { lines: true } });
      if (!original || original.merchantId !== input.merchantId) throw new NotFoundException('Écriture introuvable');
      if (original.type === 'REVERSAL') throw new BadRequestException('Une annulation ne peut pas être annulée');
      if (original.type === 'MOBILE_PAYMENT') {
        throw new BadRequestException('Un paiement Mobile Money ne s’annule pas ici : passer par un remboursement');
      }
      lines = original.lines.map((l) => ({
        account: l.account,
        amount: l.amount,
        direction: l.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      }));
      input = { ...input, amount: original.amount, customerId: original.customerId };
    } else {
      lines = this.linesFor(input.type, input.amount, input.merchantId, input.customerId);
    }
    LedgerService.assertBalanced(lines);
    try {
      return await db.ledgerEntry.create({
        data: {
          merchantId: input.merchantId,
          customerId: input.customerId,
          type: input.type,
          amount: input.amount,
          label: input.label ?? null,
          clientUuid: input.clientUuid ?? null,
          reversesId: input.reversesId ?? null,
          transactionId: input.transactionId ?? null,
          createdBy: input.createdBy ?? null,
          occurredAt: input.occurredAt ?? new Date(),
          lines: { create: lines },
        },
        include: { lines: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Écriture déjà enregistrée ou déjà annulée');
      }
      throw e;
    }
  }

  /** Solde d'un client = débits − crédits sur sa créance. Positif : il doit ; négatif : avoir. */
  async balanceOf(customerId: string, db: Tx = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<Array<{ balance: bigint | null }>>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0)::bigint AS balance
      FROM ledger_lines WHERE account = ${acc.receivable(customerId)}`;
    return Number(rows[0]?.balance ?? 0);
  }

  /** Soldes de tous les clients d'une boutique, en une requête. */
  async balancesForMerchant(merchantId: string, db: Tx = this.prisma): Promise<Map<string, number>> {
    const rows = await db.$queryRaw<Array<{ customer_id: string; balance: bigint }>>`
      SELECT e.customer_id::text AS customer_id,
             SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE -l.amount END)::bigint AS balance
      FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
      WHERE e.merchant_id = ${merchantId}::uuid AND l.account = 'recv:' || e.customer_id::text
      GROUP BY e.customer_id`;
    return new Map(rows.map((r) => [r.customer_id, Number(r.balance)]));
  }

  /** Contrôle d'intégrité : chaque écriture est équilibrée (utilisé par les tests et la réconciliation). */
  async unbalancedEntries(db: Tx = this.prisma): Promise<string[]> {
    const rows = await db.$queryRaw<Array<{ entry_id: string }>>`
      SELECT entry_id::text FROM ledger_lines GROUP BY entry_id
      HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) <> 0`;
    return rows.map((r) => r.entry_id);
  }
}
