import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { JwtGuard, MerchantId } from '../auth/auth';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerQueries } from './customers';

class UpdateMeDto {
  @IsOptional() @IsString() @Length(2, 60) shopName?: string;
}

@UseGuards(JwtGuard)
@Controller()
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerQueries,
  ) {}

  @Get('me')
  me(@MerchantId() merchantId: string) {
    return this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
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
