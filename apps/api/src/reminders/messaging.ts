import { Injectable, Logger } from '@nestjs/common';
import { SmsSender } from '../auth/auth';
import { Channel } from '../generated/prisma/client';

/**
 * Envoi WhatsApp. En production : WhatsApp Business Platform (API Cloud de Meta) ou un agrégateur,
 * avec un modèle de message « utilitaire » approuvé par Meta (obligatoire pour écrire en premier à un client).
 */
export abstract class WhatsAppSender {
  /** Lève une erreur si le message n'est pas parti (numéro sans WhatsApp, fournisseur indisponible…). */
  abstract send(phone: string, text: string): Promise<{ providerRef?: string }>;
}

/** Dev / tests : le message est écrit dans les logs et gardé en mémoire. */
@Injectable()
export class ConsoleWhatsAppSender extends WhatsAppSender {
  private readonly log = new Logger('WhatsApp');
  readonly outbox: Array<{ phone: string; text: string }> = [];
  /** Numéros simulés comme n'ayant pas WhatsApp (pour tester le repli SMS). */
  readonly unreachable = new Set<string>();

  async send(phone: string, text: string) {
    if (this.unreachable.has(phone)) throw new Error('Numéro sans compte WhatsApp');
    this.outbox.push({ phone, text });
    this.log.log(`→ ${phone} : ${text}`);
    return { providerRef: `wa-dev-${this.outbox.length}` };
  }
}

export interface Delivery {
  channel: Channel;
  providerRef?: string;
  /** Renseigné quand WhatsApp a échoué et que le SMS a pris le relais. */
  fallbackReason?: string;
}

/** WhatsApp d'abord (gratuit pour le client, lien cliquable), SMS en repli. */
@Injectable()
export class ReminderMessenger {
  constructor(
    private readonly whatsapp: WhatsAppSender,
    private readonly sms: SmsSender,
  ) {}

  async send(channel: Channel, phone: string, text: string): Promise<Delivery> {
    if (channel === 'WHATSAPP') {
      try {
        const r = await this.whatsapp.send(phone, text);
        return { channel: 'WHATSAPP', providerRef: r.providerRef };
      } catch (e) {
        await this.sms.send(phone, text);
        return { channel: 'SMS', fallbackReason: `WhatsApp : ${(e as Error).message}` };
      }
    }
    await this.sms.send(phone, text);
    return { channel: 'SMS' };
  }
}
