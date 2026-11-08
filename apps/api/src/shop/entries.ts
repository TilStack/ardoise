import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { JwtGuard, MerchantId } from '../auth/auth';
import { LedgerService, MAX_AMOUNT } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

export class CreateEntryDto {
  /** UUID généré par l'app : rend la création idempotente (rejeu de synchro hors-ligne). */
  @IsUUID() clientUuid: string;
  @IsUUID() customerId: string;
  @IsIn(['DEBT', 'CASH_REPAYMENT']) type: 'DEBT' | 'CASH_REPAYMENT';
  @IsInt() @Min(1) @Max(MAX_AMOUNT) amount: number;
  @IsOptional() @IsString() @Length(0, 120) label?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class CancelEntryDto {
  @IsUUID() clientUuid: string;
  @IsOptional() @IsString() @Length(0, 120) reason?: string;
}

export class SyncBatchDto {
  @ValidateNested({ each: true })
  @Type(() => CreateEntryDto)
  @ArrayMaxSize(500)
  entries: CreateEntryDto[];
}

@UseGuards(JwtGuard)
@Controller()
export class EntriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Dette ou remboursement en espèces. Rejouer la même requête ne crée rien de plus. */
  @Post('entries')
  async create(@MerchantId() merchantId: string, @Body() dto: CreateEntryDto) {
    return this.createOne(merchantId, dto);
  }

  /** Synchronisation des saisies faites hors-ligne, dans l'ordre du téléphone. */
  @Post('sync/entries')
  @HttpCode(200)
  async sync(@MerchantId() merchantId: string, @Body() dto: SyncBatchDto) {
    const results = [];
    for (const e of dto.entries) {
      try {
        const r = await this.createOne(merchantId, e);
        results.push({ clientUuid: e.clientUuid, status: r.duplicate ? 'DUPLICATE' : 'CREATED', entryId: r.entry.id });
      } catch (err) {
        results.push({ clientUuid: e.clientUuid, status: 'REJECTED', error: (err as Error).message });
      }
    }
    return { results };
  }

  /** Annule une saisie : rien n'est effacé, une écriture inverse est créée et reste visible. */
  @Post('entries/:id/cancel')
  async cancel(@MerchantId() merchantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelEntryDto) {
    const already = await this.prisma.ledgerEntry.findUnique({ where: { clientUuid: dto.clientUuid } });
    if (already) return { entry: already, duplicate: true };
    const original = await this.prisma.ledgerEntry.findFirst({ where: { id, merchantId }, include: { reversedBy: true } });
    if (!original) throw new NotFoundException('Écriture introuvable');
    if (original.reversedBy) throw new ConflictException('Cette écriture est déjà annulée');
    const entry = await this.ledger.post({
      merchantId,
      customerId: original.customerId,
      type: 'REVERSAL',
      amount: original.amount,
      reversesId: original.id,
      clientUuid: dto.clientUuid,
      label: dto.reason ?? 'Annulation',
      createdBy: merchantId,
    });
    return { entry, duplicate: false, balance: await this.ledger.balanceOf(original.customerId) };
  }

  private async createOne(merchantId: string, dto: CreateEntryDto) {
    const existing = await this.prisma.ledgerEntry.findUnique({ where: { clientUuid: dto.clientUuid } });
    if (existing) {
      if (existing.merchantId !== merchantId) throw new ConflictException('Identifiant déjà utilisé');
      return { entry: existing, duplicate: true, balance: await this.ledger.balanceOf(existing.customerId) };
    }
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, merchantId } });
    if (!customer) throw new NotFoundException('Client introuvable');
    // Une nouvelle saisie sur un client archivé (ex. saisie hors-ligne synchronisée plus tard) le réactive.
    if (customer.archivedAt) await this.prisma.customer.update({ where: { id: customer.id }, data: { archivedAt: null } });
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Date dans le futur');

    let entry;
    try {
      entry = await this.ledger.post({
        merchantId,
        customerId: customer.id,
        type: dto.type,
        amount: dto.amount,
        label: dto.label,
        clientUuid: dto.clientUuid,
        occurredAt,
        createdBy: merchantId,
      });
    } catch (e) {
      // Deux synchros concurrentes du même clientUuid : la seconde renvoie la première.
      if (e instanceof ConflictException) {
        const dup = await this.prisma.ledgerEntry.findUnique({ where: { clientUuid: dto.clientUuid } });
        if (dup) return { entry: dup, duplicate: true, balance: await this.ledger.balanceOf(dup.customerId) };
      }
      throw e;
    }
    const balance = await this.ledger.balanceOf(customer.id);
    const overLimit = dto.type === 'DEBT' && customer.creditLimit != null && balance > customer.creditLimit;
    return { entry, duplicate: false, balance, overLimit };
  }
}
