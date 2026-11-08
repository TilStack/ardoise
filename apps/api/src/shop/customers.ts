import { Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { detectOperator } from '@ardoise/pay-core';
import { JwtGuard, MerchantId, toPhone } from '../auth/auth';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

export class CreateCustomerDto {
  @IsOptional() @IsUUID() clientUuid?: string;
  @IsString() @Length(1, 80) name: string;
  @IsString() phone: string;
  @IsOptional() @IsIn(['MTN', 'ORANGE']) operator?: 'MTN' | 'ORANGE';
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) creditLimit?: number;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsBoolean() consentReminders?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) creditLimit?: number | null;
}

/** Un client est « en retard » s'il doit de l'argent et n'a eu aucune activité depuis ce délai. */
export const LATE_AFTER_DAYS = 7;

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string;
  operator: string | null;
  balance: number;
  lastActivityAt: Date | null;
  daysLate: number;
  status: 'LATE' | 'UP_TO_DATE' | 'SETTLED' | 'CREDIT';
}

@Injectable()
export class CustomerQueries {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Par défaut, les clients archivés sont exclus ; `archived: true` ne renvoie qu'eux. */
  async summaries(merchantId: string, now = new Date(), archived = false): Promise<CustomerSummary[]> {
    const [customers, balances, activity] = await Promise.all([
      this.prisma.customer.findMany({ where: { merchantId, archivedAt: archived ? { not: null } : null } }),
      this.ledger.balancesForMerchant(merchantId),
      this.prisma.ledgerEntry.groupBy({ by: ['customerId'], where: { merchantId }, _max: { occurredAt: true } }),
    ]);
    const last = new Map(activity.map((a) => [a.customerId, a._max.occurredAt]));
    return customers.map((c) => {
      const balance = balances.get(c.id) ?? 0;
      const lastActivityAt = last.get(c.id) ?? null;
      const idleDays = lastActivityAt ? Math.floor((now.getTime() - lastActivityAt.getTime()) / 86_400_000) : 0;
      const late = balance > 0 && idleDays >= LATE_AFTER_DAYS;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        operator: c.operator,
        balance,
        lastActivityAt,
        daysLate: late ? idleDays : 0,
        status: balance < 0 ? 'CREDIT' : balance === 0 ? 'SETTLED' : late ? 'LATE' : 'UP_TO_DATE',
      };
    });
  }
}

@UseGuards(JwtGuard)
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly queries: CustomerQueries,
  ) {}

  @Post()
  async create(@MerchantId() merchantId: string, @Body() dto: CreateCustomerDto) {
    const phone = toPhone(dto.phone);
    // Idempotent : même clientUuid (synchro hors-ligne) ou même numéro → on renvoie le client existant.
    const existing = await this.prisma.customer.findFirst({
      where: { merchantId, OR: [{ phone }, ...(dto.clientUuid ? [{ clientUuid: dto.clientUuid }] : [])] },
    });
    if (existing) {
      // Recréer un client archivé (même numéro) le réactive, avec tout son historique.
      if (existing.archivedAt) return this.prisma.customer.update({ where: { id: existing.id }, data: { archivedAt: null } });
      return existing;
    }
    try {
      return await this.prisma.customer.create({
        data: {
          // Client créé hors-ligne : l'identifiant du téléphone devient l'identifiant serveur.
          ...(dto.clientUuid ? { id: dto.clientUuid } : {}),
          merchantId,
          clientUuid: dto.clientUuid,
          name: dto.name.trim(),
          phone,
          operator: dto.operator ?? detectOperator(phone),
          creditLimit: dto.creditLimit,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.customer.findFirstOrThrow({ where: { merchantId, phone } });
      }
      throw e;
    }
  }

  @Get()
  async list(
    @MerchantId() merchantId: string,
    @Query('filter') filter?: 'late' | 'up_to_date',
    @Query('q') q?: string,
    @Query('archived') archived?: string,
  ) {
    const all = await this.queries.summaries(merchantId, new Date(), archived === 'true');
    let rows = all;
    if (filter === 'late') rows = rows.filter((c) => c.status === 'LATE');
    if (filter === 'up_to_date') rows = rows.filter((c) => c.status !== 'LATE');
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(needle) || c.phone.includes(q.replace(/\s/g, '')));
    }
    return {
      counts: { all: all.length, late: all.filter((c) => c.status === 'LATE').length },
      customers: rows.sort((a, b) => b.daysLate - a.daysLate || b.balance - a.balance),
    };
  }

  @Get(':id')
  async detail(@MerchantId() merchantId: string, @Param('id', ParseUUIDPipe) id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, merchantId } });
    if (!customer) throw new NotFoundException('Client introuvable');
    const [balance, entries] = await Promise.all([
      this.ledger.balanceOf(id),
      this.prisma.ledgerEntry.findMany({
        where: { customerId: id },
        orderBy: { occurredAt: 'desc' },
        take: 100,
        include: { receipt: { select: { number: true } }, reversedBy: { select: { id: true } } },
      }),
    ]);
    return {
      customer,
      balance,
      creditUsedPercent: customer.creditLimit ? Math.round((balance / customer.creditLimit) * 100) : null,
      history: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        // signe vu du client : + il doit plus, − il a payé
        signedAmount: e.type === 'DEBT' ? e.amount : e.type === 'REVERSAL' ? 0 : -e.amount,
        label: e.label,
        occurredAt: e.occurredAt,
        receiptNumber: e.receipt?.number ?? null,
        reversed: !!e.reversedBy,
        reversesId: e.reversesId,
      })),
    };
  }

  @Patch(':id')
  async update(@MerchantId() merchantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    const c = await this.prisma.customer.findFirst({ where: { id, merchantId } });
    if (!c) throw new NotFoundException('Client introuvable');
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  /** Archive un client dont le solde est à 0 : il quitte les listes, son historique reste intact. */
  @Post(':id/archive')
  @HttpCode(200)
  async archive(@MerchantId() merchantId: string, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, merchantId } });
    if (!c) throw new NotFoundException('Client introuvable');
    const balance = await this.ledger.balanceOf(id);
    if (balance !== 0) throw new ConflictException('Un client ne peut être archivé que si son solde est à 0');
    return this.prisma.customer.update({ where: { id }, data: { archivedAt: c.archivedAt ?? new Date() } });
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  async unarchive(@MerchantId() merchantId: string, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, merchantId } });
    if (!c) throw new NotFoundException('Client introuvable');
    return this.prisma.customer.update({ where: { id }, data: { archivedAt: null } });
  }
}
