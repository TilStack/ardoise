import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Patch, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { JwtGuard, MerchantId } from '../auth/auth';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerQueries } from './customers';

class UpdateMeDto {
  /** Commerçant : nom de la boutique. Particulier : son prénom ou nom. */
  @IsOptional() @IsString() @Length(2, 60) shopName?: string;
  @IsOptional() @IsIn(['MERCHANT', 'PERSONAL']) profileType?: 'MERCHANT' | 'PERSONAL';
}

@UseGuards(JwtGuard)
@Controller()
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerQueries,
    private readonly ledger: LedgerService,
  ) {}

  @Get('me')
  async me(@MerchantId() merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Compte introuvable');
    return merchant;
  }

  /**
   * Suppression définitive du compte et de toutes ses données (clients, écritures, reçus, relances).
   * Refusée tant que des comptes ne sont pas réglés : un solde non nul ou un paiement mobile en cours.
   */
  @Delete('me')
  @HttpCode(200)
  async deleteAccount(@MerchantId() merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Compte introuvable');

    const balances = await this.ledger.balancesForMerchant(merchantId);
    const unsettled = [...balances.values()].filter((b) => b !== 0).length;
    if (unsettled > 0) {
      throw new ConflictException(
        `Suppression impossible : ${unsettled} compte${unsettled > 1 ? 's' : ''} non réglé${unsettled > 1 ? 's' : ''}. Soldez-les d’abord.`,
      );
    }
    const pending = await this.prisma.transaction.count({ where: { merchantId, status: 'PENDING' } });
    if (pending > 0) {
      throw new ConflictException('Suppression impossible : un paiement mobile est encore en cours. Réessayez dans quelques minutes.');
    }

    // Ordre imposé par les clés étrangères, le tout dans une seule transaction.
    await this.prisma.$transaction([
      this.prisma.reminder.deleteMany({ where: { merchantId } }),
      this.prisma.receipt.deleteMany({ where: { merchantId } }),
      this.prisma.providerEvent.deleteMany({ where: { transaction: { merchantId } } }),
      this.prisma.ledgerLine.deleteMany({ where: { entry: { merchantId } } }),
      this.prisma.ledgerEntry.deleteMany({ where: { merchantId } }),
      this.prisma.transaction.deleteMany({ where: { merchantId } }),
      this.prisma.paymentLink.deleteMany({ where: { merchantId } }),
      this.prisma.customer.deleteMany({ where: { merchantId } }),
      this.prisma.otpChallenge.deleteMany({ where: { phone: merchant.phone } }),
      this.prisma.merchant.delete({ where: { id: merchantId } }),
    ]);
    return { deleted: true };
  }

  @Patch('me')
  update(@MerchantId() merchantId: string, @Body() dto: UpdateMeDto) {
    return this.prisma.merchant.update({ where: { id: merchantId }, data: dto });
  }

  /** Tableau de bord : ce qu'on vous doit, l'encaissé du mois, l'argent en transit, les retards. */
  @Get('dashboard')
  async dashboard(@MerchantId() merchantId: string) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [summaries, collected, reversedCash, pending, recentPayments] = await Promise.all([
      this.customers.summaries(merchantId, now),
      this.prisma.ledgerEntry.aggregate({
        where: { merchantId, type: { in: ['CASH_REPAYMENT', 'MOBILE_PAYMENT'] }, occurredAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { merchantId, type: 'REVERSAL', occurredAt: { gte: monthStart }, reverses: { type: 'CASH_REPAYMENT' } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({ where: { merchantId, status: 'PENDING' }, _sum: { amount: true } }),
      this.prisma.ledgerEntry.findMany({
        where: { merchantId, type: { in: ['CASH_REPAYMENT', 'MOBILE_PAYMENT'] } },
        orderBy: { occurredAt: 'desc' },
        take: 5,
        include: { customer: { select: { name: true } } },
      }),
    ]);
    const late = summaries.filter((s) => s.status === 'LATE').sort((a, b) => b.daysLate - a.daysLate);
    return {
      totalOwed: summaries.reduce((t, s) => t + Math.max(0, s.balance), 0),
      customersCount: summaries.length,
      lateCount: late.length,
      collectedThisMonth: (collected._sum.amount ?? 0) - (reversedCash._sum.amount ?? 0),
      inTransit: pending._sum.amount ?? 0,
      toRemind: late.slice(0, 5),
      recentPayments: recentPayments.map((e) => ({
        id: e.id,
        customerName: e.customer.name,
        type: e.type,
        amount: e.amount,
        occurredAt: e.occurredAt,
      })),
    };
  }
}
