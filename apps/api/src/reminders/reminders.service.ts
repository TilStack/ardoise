import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Channel, Prisma, Reminder } from '../generated/prisma/client';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { ReminderMessenger } from './messaging';
import {
  atDoualaHour,
  DebtState,
  debtState,
  DEFAULT_TEMPLATE,
  deferral,
  inSendWindow,
  Movement,
  nextReminder,
  nextSendable,
  OPT_OUT_SUFFIX,
  renderMessage,
  validateTemplate,
} from './rules';

/** Après 3 tentatives techniques ratées, le rappel est abandonné (le palier suivant prendra le relais). */
export const MAX_ATTEMPTS = 3;
/** Un envoi « en cours » depuis plus longtemps est considéré comme interrompu. */
export const SENDING_TIMEOUT_MS = 10 * 60_000;
/** Un paiement reçu dans ce délai après une relance lui est attribué. */
export const ATTRIBUTION_MS = 7 * 86_400_000;
const STATS_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ReminderSettingsInput {
  enabled?: boolean;
  sendHour?: number;
  template?: string | null;
  channel?: Channel;
}

export type ReminderAction = 'postpone' | 'skip' | 'send_now' | 'set_channel';

type Outcome = 'sent' | 'deferred' | 'cancelled' | 'retry' | 'failed' | 'taken';

@Injectable()
export class RemindersService {
  private readonly log = new Logger('Relances');

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly messenger: ReminderMessenger,
  ) {}

  // ---------------- État des dettes ----------------

  /** Solde, début de la période de dette et dernier paiement, rejoués depuis le grand livre. */
  async debtStates(merchantId: string, customerIds?: string[], db: Tx = this.prisma): Promise<Map<string, DebtState>> {
    const only = customerIds ? Prisma.sql`AND e.customer_id = ANY(${customerIds}::uuid[])` : Prisma.empty;
    const rows = await db.$queryRaw<Array<{ customer_id: string; occurred_at: Date; type: string; delta: bigint }>>`
      SELECT e.customer_id::text AS customer_id, e.occurred_at, e.type::text AS type,
             SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE -l.amount END)::bigint AS delta
      FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
      WHERE e.merchant_id = ${merchantId}::uuid AND l.account = 'recv:' || e.customer_id::text ${only}
      GROUP BY e.id
      ORDER BY e.customer_id, e.occurred_at, e.created_at`;
    const byCustomer = new Map<string, Movement[]>();
    for (const r of rows) {
      const list = byCustomer.get(r.customer_id) ?? [];
      list.push({ at: r.occurred_at, delta: Number(r.delta), isPayment: r.type === 'CASH_REPAYMENT' || r.type === 'MOBILE_PAYMENT' });
      byCustomer.set(r.customer_id, list);
    }
    return new Map([...byCustomer].map(([id, m]) => [id, debtState(m)]));
  }

  // ---------------- Planification ----------------

  /**
   * Met à jour les rappels programmés d'une boutique : au plus un rappel « programmé » par client,
   * annulé dès qu'il devient sans objet. Idempotent, sérialisé par boutique (verrou consultatif).
   */
  async plan(merchantId: string, now = new Date()) {
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`reminders:${merchantId}`}))) AS l`;
      const merchant = await db.merchant.findUniqueOrThrow({ where: { id: merchantId } });
      const cancel = (ids: string[], reason: string) =>
        ids.length ? db.reminder.updateMany({ where: { id: { in: ids }, status: 'SCHEDULED' }, data: { status: 'CANCELLED', error: reason } }) : null;

      if (!merchant.remindersEnabled) {
        await db.reminder.updateMany({ where: { merchantId, status: 'SCHEDULED' }, data: { status: 'CANCELLED', error: 'Relances désactivées' } });
        return { created: 0 };
      }

      const [customers, states] = await Promise.all([
        db.customer.findMany({ where: { merchantId }, select: { id: true, consentReminders: true } }),
        this.debtStates(merchantId, undefined, db),
      ]);
      const starts = [...states.values()].map((s) => s.cycleStart?.getTime()).filter((t): t is number => t !== undefined);
      const [rows, lastSent] = await Promise.all([
        db.reminder.findMany({
          where: {
            merchantId,
            OR: [{ status: { in: ['SCHEDULED', 'SENDING'] } }, ...(starts.length ? [{ cycleStart: { gte: new Date(Math.min(...starts)) } }] : [])],
          },
        }),
        db.reminder.groupBy({ by: ['customerId'], where: { merchantId, status: 'SENT' }, _max: { sentAt: true } }),
      ]);
      const lastSentBy = new Map(lastSent.map((r) => [r.customerId, r._max.sentAt]));
      const rowsBy = new Map<string, Reminder[]>();
      for (const r of rows) rowsBy.set(r.customerId, [...(rowsBy.get(r.customerId) ?? []), r]);

      let created = 0;
      for (const c of customers) {
        const st = states.get(c.id);
        const mine = rowsBy.get(c.id) ?? [];
        const scheduled = mine.filter((r) => r.status === 'SCHEDULED');
        if (!c.consentReminders || !st?.cycleStart || st.balance <= 0) {
          await cancel(scheduled.map((r) => r.id), !c.consentReminders ? 'Le client a refusé les rappels' : 'Dette réglée');
          continue;
        }
        if (mine.some((r) => r.status === 'SENDING')) continue;
        const cycle = st.cycleStart.getTime();
        if (scheduled.some((r) => r.cycleStart.getTime() === cycle)) continue;
        await cancel(scheduled.map((r) => r.id), 'Nouvelle période de dette');

        const inCycle = mine.filter((r) => r.cycleStart.getTime() === cycle);
        const next = nextReminder({
          cycleStart: st.cycleStart,
          doneSteps: inCycle.filter((r) => ['SENT', 'FAILED', 'SKIPPED'].includes(r.status)).map((r) => r.step),
          lastSentAt: lastSentBy.get(c.id) ?? null,
          lastPaymentAt: st.lastPaymentAt,
          sendHour: merchant.reminderSendHour,
          now,
        });
        if (!next) continue;
        const existing = inCycle.find((r) => r.step === next.step);
        if (existing && existing.status !== 'CANCELLED') continue;
        const data = { scheduledAt: next.scheduledAt, channel: merchant.reminderChannel, status: 'SCHEDULED' as const, error: null };
        if (existing) await db.reminder.update({ where: { id: existing.id }, data });
        else await db.reminder.create({ data: { ...data, merchantId, customerId: c.id, cycleStart: st.cycleStart, step: next.step } });
        created++;
      }
      return { created };
    }, { timeout: 30_000 });
  }

  // ---------------- Envoi ----------------

  /** Envoie les rappels arrivés à échéance. Hors de la plage 8 h – 20 h, ne fait rien. */
  async dispatchDue(now = new Date(), limit = 200) {
    const result: Record<Outcome, number> = { sent: 0, deferred: 0, cancelled: 0, retry: 0, failed: 0, taken: 0 };
    if (!inSendWindow(now)) return result;
    const due = await this.prisma.reminder.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now }, merchant: { remindersEnabled: true } },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const r of due) result[await this.sendOne(r.id, now)]++;
    return result;
  }

  /**
   * Envoie un rappel. La réservation (SCHEDULED → SENDING, conditionnelle) garantit qu'un même rappel
   * n'est jamais envoyé deux fois, même si plusieurs instances de l'API tournent en parallèle.
   */
  async sendOne(id: string, now = new Date()): Promise<Outcome> {
    const claim = await this.prisma.reminder.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'SENDING', attempts: { increment: 1 } } });
    if (!claim.count) return 'taken';
    const r = await this.prisma.reminder.findUniqueOrThrow({ where: { id }, include: { customer: true, merchant: true } });
    const set = (data: Prisma.ReminderUpdateInput) => this.prisma.reminder.update({ where: { id }, data });
    try {
      const st = (await this.debtStates(r.merchantId, [r.customerId])).get(r.customerId);
      if (!r.merchant.remindersEnabled || !r.customer.consentReminders || !st?.cycleStart || st.balance <= 0 || st.cycleStart.getTime() !== r.cycleStart.getTime()) {
        await set({ status: 'CANCELLED', error: !r.customer.consentReminders ? 'Le client a refusé les rappels' : 'Plus de dette à rappeler' });
        return 'cancelled';
      }
      const last = await this.prisma.reminder.findFirst({ where: { customerId: r.customerId, status: 'SENT' }, orderBy: { sentAt: 'desc' } });
      const later = deferral(now, last?.sentAt ?? null, st.lastPaymentAt, r.merchant.reminderSendHour);
      if (later) {
        await set({ status: 'SCHEDULED', scheduledAt: later });
        return 'deferred';
      }

      const link = await this.payments.createLink(r.merchantId, r.customerId);
      const text = renderMessage(r.merchant.reminderTemplate, { name: r.customer.name, amount: st.balance, shop: r.merchant.shopName, url: link.url });
      const delivery = await this.messenger.send(r.channel, r.customer.phone, text);
      await set({
        status: 'SENT',
        sentAt: now,
        sentChannel: delivery.channel,
        amount: st.balance,
        message: text,
        paymentLink: { connect: { id: link.linkId } },
        providerRef: delivery.providerRef ?? null,
        error: delivery.fallbackReason ?? null,
      });
      return 'sent';
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      this.log.warn(`Rappel ${id} : ${msg}`);
      if (r.attempts >= MAX_ATTEMPTS) {
        await set({ status: 'FAILED', error: msg });
        return 'failed';
      }
      await set({ status: 'SCHEDULED', scheduledAt: nextSendable(new Date(now.getTime() + 30 * 60_000), r.merchant.reminderSendHour), error: msg });
      return 'retry';
    }
  }

  /**
   * Un envoi resté « en cours » (arrêt brutal entre l'envoi et l'écriture du résultat) : on ne sait pas
   * si le message est parti. On le marque en échec sans le renvoyer : mieux vaut un rappel manqué qu'un doublon.
   */
  async recoverStuck(now = new Date()) {
    const r = await this.prisma.reminder.updateMany({
      where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - SENDING_TIMEOUT_MS) } },
      data: { status: 'FAILED', error: 'Envoi interrompu : statut inconnu, non renvoyé' },
    });
    return r.count;
  }

  /** Tâche périodique : rattrapage, planification de chaque boutique, puis envoi. */
  async runOnce(now = new Date()) {
    const stuck = await this.recoverStuck(now);
    const merchants = await this.prisma.merchant.findMany({ where: { remindersEnabled: true, customers: { some: {} } }, select: { id: true } });
    for (const m of merchants) await this.plan(m.id, now);
    return { stuck, ...(await this.dispatchDue(now)) };
  }

  // ---------------- Écran « Relances » ----------------

  async overview(merchantId: string, now = new Date()) {
    await this.plan(merchantId, now);
    const since = new Date(now.getTime() - STATS_DAYS * DAY_MS);
    const [merchant, scheduled, history] = await Promise.all([
      this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } }),
      this.prisma.reminder.findMany({
        where: { merchantId, status: { in: ['SCHEDULED', 'SENDING'] } },
        orderBy: { scheduledAt: 'asc' },
        include: { customer: { select: { name: true, phone: true } } },
      }),
      this.prisma.reminder.findMany({
        where: { merchantId, OR: [{ status: 'SENT', sentAt: { gte: since } }, { status: 'FAILED', updatedAt: { gte: since } }] },
        orderBy: [{ sentAt: 'desc' }, { updatedAt: 'desc' }],
        include: { customer: { select: { name: true, phone: true } } },
      }),
    ]);
    const states = await this.debtStates(merchantId, scheduled.map((r) => r.customerId));

    // Attribution : paiements reçus dans les 7 jours suivant une relance (et avant la relance suivante).
    const sent = history.filter((r) => r.status === 'SENT' && r.sentAt);
    const payments = sent.length
      ? await this.prisma.ledgerEntry.findMany({
          where: {
            merchantId,
            type: { in: ['CASH_REPAYMENT', 'MOBILE_PAYMENT'] },
            reversedBy: null,
            occurredAt: { gte: new Date(Math.min(...sent.map((r) => r.sentAt!.getTime()))) },
          },
          select: { customerId: true, amount: true, occurredAt: true },
        })
      : [];
    const paidAfter = (r: Reminder) => {
      const start = r.sentAt!.getTime();
      const nextSent = sent.filter((o) => o.customerId === r.customerId && o.sentAt!.getTime() > start).map((o) => o.sentAt!.getTime());
      const end = Math.min(start + ATTRIBUTION_MS, ...nextSent);
      return payments
        .filter((p) => p.customerId === r.customerId && p.occurredAt.getTime() >= start && p.occurredAt.getTime() < end)
        .reduce((t, p) => t + p.amount, 0);
    };

    const item = (r: Reminder & { customer: { name: string; phone: string } }) => ({
      id: r.id,
      customerId: r.customerId,
      customerName: r.customer.name,
      phone: r.customer.phone,
      step: r.step,
      status: r.status,
      channel: r.channel,
      scheduledAt: r.scheduledAt,
      amount: r.status === 'SENT' || r.status === 'FAILED' ? (r.amount ?? 0) : Math.max(0, states.get(r.customerId)?.balance ?? 0),
      sentAt: r.sentAt,
      sentChannel: r.sentChannel,
      paidAmount: r.status === 'SENT' && r.sentAt ? paidAfter(r) : 0,
      error: r.error,
    });
    const scheduledItems = scheduled.map(item);
    const historyItems = history.map(item);
    const paidItems = historyItems.filter((i) => i.paidAmount > 0);
    const endOfToday = atDoualaHour(now, 0, 1);

    return {
      settings: this.settingsOf(merchant),
      today: scheduledItems.filter((i) => new Date(i.scheduledAt) < endOfToday).length,
      counts: { scheduled: scheduledItems.length, sent: historyItems.filter((i) => i.status === 'SENT').length, paid: paidItems.length },
      recovered: paidItems.reduce((t, i) => t + i.paidAmount, 0),
      scheduled: scheduledItems,
      sent: historyItems,
      paid: paidItems,
    };
  }

  settingsOf(m: { remindersEnabled: boolean; reminderSendHour: number; reminderTemplate: string | null; reminderChannel: Channel }) {
    return {
      enabled: m.remindersEnabled,
      sendHour: m.reminderSendHour,
      channel: m.reminderChannel,
      template: m.reminderTemplate ?? DEFAULT_TEMPLATE,
      customTemplate: m.reminderTemplate !== null,
      defaultTemplate: DEFAULT_TEMPLATE,
      optOutSuffix: OPT_OUT_SUFFIX,
    };
  }

  async updateSettings(merchantId: string, dto: ReminderSettingsInput) {
    if (dto.template !== undefined && dto.template !== null) {
      const err = validateTemplate(dto.template);
      if (err) throw new BadRequestException(err);
    }
    const template = dto.template === undefined ? undefined : dto.template === null || dto.template.trim() === DEFAULT_TEMPLATE ? null : dto.template.trim();
    const m = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { remindersEnabled: dto.enabled, reminderSendHour: dto.sendHour, reminderTemplate: template, reminderChannel: dto.channel },
    });
    // Les rappels déjà programmés suivent les nouveaux réglages.
    const pending = await this.prisma.reminder.findMany({ where: { merchantId, status: 'SCHEDULED' } });
    for (const r of pending) {
      await this.prisma.reminder.update({
        where: { id: r.id },
        data: {
          ...(dto.sendHour !== undefined ? { scheduledAt: atDoualaHour(r.scheduledAt, dto.sendHour) } : {}),
          ...(dto.channel ? { channel: dto.channel } : {}),
        },
      });
    }
    if (dto.enabled !== undefined) await this.plan(merchantId);
    return this.settingsOf(m);
  }

  async act(merchantId: string, id: string, action: ReminderAction, channel?: Channel, now = new Date()) {
    const r = await this.prisma.reminder.findFirst({ where: { id, merchantId }, include: { merchant: true } });
    if (!r) throw new NotFoundException('Relance introuvable');
    if (r.status !== 'SCHEDULED') throw new ConflictException('Cette relance n’est plus modifiable');
    let outcome: Outcome | 'updated' = 'updated';
    switch (action) {
      case 'postpone':
        await this.prisma.reminder.update({
          where: { id },
          data: { scheduledAt: atDoualaHour(r.scheduledAt > now ? r.scheduledAt : now, r.merchant.reminderSendHour, 1) },
        });
        break;
      case 'skip':
        await this.prisma.reminder.update({ where: { id }, data: { status: 'SKIPPED', error: 'Ignorée par la boutique' } });
        break;
      case 'set_channel':
        if (!channel) throw new BadRequestException('Canal attendu : WHATSAPP ou SMS');
        await this.prisma.reminder.update({ where: { id }, data: { channel } });
        break;
      case 'send_now':
        if (!inSendWindow(now)) throw new ConflictException('Les rappels partent entre 8 h et 20 h');
        await this.prisma.reminder.update({ where: { id }, data: { scheduledAt: now } });
        outcome = await this.sendOne(id, now);
        break;
    }
    const after = await this.prisma.reminder.findUniqueOrThrow({ where: { id } });
    return { outcome, reminder: after };
  }

  /** Lien « Ne plus recevoir de rappels » de la page de paiement (fonctionne même si le lien a expiré). */
  async optOut(tokenHash: string) {
    const link = await this.prisma.paymentLink.findUnique({ where: { tokenHash }, include: { merchant: true } });
    if (!link) throw new NotFoundException('Lien inconnu');
    await this.prisma.customer.update({ where: { id: link.customerId }, data: { consentReminders: false } });
    await this.prisma.reminder.updateMany({
      where: { customerId: link.customerId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', error: 'Le client a refusé les rappels' },
    });
    return { ok: true, shopName: link.merchant.shopName };
  }
}
