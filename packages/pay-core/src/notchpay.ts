import { headerValue, hmacSha256Hex, safeEqualHex } from './signature';
import {
  Headers,
  InitiateInput,
  InitiateResult,
  PaymentProvider,
  ProviderError,
  StatusResult,
  TxStatus,
  WebhookEvent,
} from './types';

/**
 * Adaptateur NotchPay (https://notchpay.co).
 *
 * Endpoints confirmés à partir du SDK officiel `notchpay.js@1.0.1` :
 *   POST   /payments/initialize   crée le paiement           (en-tête Authorization: <clé publique>)
 *   PUT    /payments/{reference}  déclenche le débit mobile   { channel: 'cm.mtn' | 'cm.orange', data: { phone } }
 *   GET    /payments/{reference}  lit le statut
 *
 * À VÉRIFIER dans https://developer.notchpay.co avant la production (domaine bloqué dans
 * l'environnement de développement) :
 *   - le nom de l'en-tête de signature des webhooks et le secret utilisé (configurables ici) ;
 *   - la forme exacte du corps des webhooks (le parseur est tolérant et, de toute façon,
 *     le statut est toujours relu via getStatus() avant tout crédit) ;
 *   - la liste exhaustive des statuts (voir mapStatus).
 */
export interface NotchPayConfig {
  publicKey: string;
  /** Clé privée : requise par certains endpoints (transferts / payouts, V2). */
  privateKey?: string;
  webhookSecret: string;
  webhookSignatureHeader?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const CHANNEL = { MTN: 'cm.mtn', ORANGE: 'cm.orange' } as const;

export function mapNotchPayStatus(s: string | undefined): TxStatus {
  switch ((s ?? '').toLowerCase()) {
    case 'complete':
    case 'completed':
    case 'success':
    case 'successful':
      return 'SUCCESS';
    case 'failed':
    case 'rejected':
    case 'declined':
      return 'FAILED';
    case 'canceled':
    case 'cancelled':
    case 'expired':
    case 'abandoned':
      return 'EXPIRED';
    default:
      // pending, processing, incomplete, ou inconnu : on n'en déduit rien de définitif.
      return 'PENDING';
  }
}

export class NotchPayProvider implements PaymentProvider {
  readonly name = 'notchpay';
  private readonly baseUrl: string;
  private readonly sigHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: NotchPayConfig) {
    if (!cfg.publicKey) throw new Error('NotchPay: publicKey manquante');
    if (!cfg.webhookSecret) throw new Error('NotchPay: webhookSecret manquant');
    this.baseUrl = (cfg.baseUrl ?? 'https://api.notchpay.co').replace(/\/$/, '');
    this.sigHeader = cfg.webhookSignatureHeader ?? 'x-notch-signature';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 15000);
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: this.cfg.publicKey,
          ...(this.cfg.privateKey ? { 'X-Grant': this.cfg.privateKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const json = text ? safeJson(text) : {};
      if (!res.ok) {
        const msg = (json as { message?: string })?.message ?? `HTTP ${res.status}`;
        throw new ProviderError(`NotchPay ${method} ${path} : ${msg}`, this.name, res.status, json);
      }
      return json as T;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      // Timeout ou erreur réseau : le résultat est INCONNU, l'appelant ne doit pas conclure à un échec.
      throw new ProviderError(`NotchPay ${method} ${path} : ${(e as Error).message}`, this.name, undefined, e);
    } finally {
      clearTimeout(timer);
    }
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new ProviderError('Montant invalide', this.name);
    }
    type InitResp = { transaction?: { reference?: string; status?: string } };
    const init = await this.call<InitResp>('POST', '/payments/initialize', {
      reference: input.reference,
      amount: input.amount,
      currency: input.currency,
      phone: input.phone,
      email: input.customerEmail,
      name: input.customerName,
      description: input.description,
      callback: input.callbackUrl,
      locked_currency: input.currency,
      locked_country: 'CM',
    });
    const providerRef = init.transaction?.reference;
    if (!providerRef) throw new ProviderError('Réponse NotchPay sans transaction.reference', this.name, undefined, init);

    // Déclenche la demande de validation (push USSD) sur le téléphone du client.
    const charge = await this.call<InitResp>('PUT', `/payments/${encodeURIComponent(providerRef)}`, {
      channel: CHANNEL[input.operator],
      data: { phone: input.phone },
    });
    return { providerRef, status: mapNotchPayStatus(charge.transaction?.status ?? 'pending'), raw: { init, charge } };
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    type Resp = { transaction?: { reference?: string; status?: string; amount?: number | string; currency?: string } };
    const r = await this.call<Resp>('GET', `/payments/${encodeURIComponent(providerRef)}`);
    const t = r.transaction ?? {};
    return {
      providerRef: t.reference ?? providerRef,
      status: mapNotchPayStatus(t.status),
      amount: Number(t.amount ?? 0),
      currency: t.currency ?? 'XAF',
      raw: r,
    };
  }

  verifyWebhook(rawBody: Buffer | string, headers: Headers): boolean {
    const sig = headerValue(headers, this.sigHeader);
    if (!sig) return false;
    return safeEqualHex(hmacSha256Hex(this.cfg.webhookSecret, rawBody), sig.trim());
  }

  parseWebhook(rawBody: Buffer | string): WebhookEvent {
    const body = safeJson(rawBody.toString()) as Record<string, any>;
    const data = (body?.data ?? body) as Record<string, any>;
    const providerRef = data?.reference ?? data?.transaction?.reference;
    if (!providerRef) throw new ProviderError('Webhook NotchPay sans référence', this.name, undefined, body);
    return {
      providerRef: String(providerRef),
      merchantReference: data?.merchant_reference ?? data?.trxref ?? undefined,
      announcedStatus: data?.status ? mapNotchPayStatus(String(data.status)) : undefined,
      raw: body,
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
