import { hmacSha256Hex, headerValue, randomToken, safeEqualHex } from './signature';
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
 * Fournisseur de paiement simulé, pour le développement et les tests (aucun appel réseau).
 *
 * Règles de simulation selon les 4 derniers chiffres du numéro payeur :
 *   ...0000 → refus immédiat à l'initialisation (FAILED)
 *   ...9999 → l'API du fournisseur est indisponible (ProviderError)
 *   autre   → PENDING, jusqu'à ce que `simulate()` soit appelé (le client « tape son PIN »).
 */
interface SandboxTx {
  providerRef: string;
  reference: string;
  amount: number;
  currency: string;
  status: TxStatus;
}

export class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox';
  static readonly SIGNATURE_HEADER = 'x-sandbox-signature';
  private readonly txs = new Map<string, SandboxTx>();

  constructor(private readonly webhookSecret: string) {}

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (input.phone.endsWith('9999')) throw new ProviderError('Sandbox : fournisseur indisponible', this.name, 503);
    const existing = [...this.txs.values()].find((t) => t.reference === input.reference);
    if (existing) return { providerRef: existing.providerRef, status: existing.status, raw: existing };
    const tx: SandboxTx = {
      providerRef: `sbx_${randomToken(9)}`,
      reference: input.reference,
      amount: input.amount,
      currency: input.currency,
      status: input.phone.endsWith('0000') ? 'FAILED' : 'PENDING',
    };
    this.txs.set(tx.providerRef, tx);
    return { providerRef: tx.providerRef, status: tx.status, raw: { ...tx } };
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const tx = this.txs.get(providerRef);
    if (!tx) throw new ProviderError('Sandbox : transaction inconnue', this.name, 404);
    return { providerRef, status: tx.status, amount: tx.amount, currency: tx.currency, raw: { ...tx } };
  }

  /**
   * Simule la décision du client (ou de l'opérateur) et renvoie le webhook signé
   * que le fournisseur aurait envoyé. `amountOverride` permet de tester un montant incohérent.
   */
  simulate(providerRef: string, status: 'SUCCESS' | 'FAILED' | 'EXPIRED', amountOverride?: number) {
    const tx = this.txs.get(providerRef);
    if (!tx) throw new ProviderError('Sandbox : transaction inconnue', this.name, 404);
    tx.status = status;
    if (amountOverride !== undefined) tx.amount = amountOverride;
    const body = JSON.stringify({
      event: `payment.${status.toLowerCase()}`,
      data: { reference: tx.providerRef, merchant_reference: tx.reference, status, amount: tx.amount, currency: tx.currency },
    });
    return { body, headers: { [SandboxProvider.SIGNATURE_HEADER]: this.sign(body) } };
  }

  sign(body: string): string {
    return hmacSha256Hex(this.webhookSecret, body);
  }

  verifyWebhook(rawBody: Buffer | string, headers: Headers): boolean {
    const sig = headerValue(headers, SandboxProvider.SIGNATURE_HEADER);
    return !!sig && safeEqualHex(this.sign(rawBody.toString()), sig);
  }

  parseWebhook(rawBody: Buffer | string): WebhookEvent {
    const body = JSON.parse(rawBody.toString());
    return {
      providerRef: body.data.reference,
      merchantReference: body.data.merchant_reference,
      announcedStatus: body.data.status,
      raw: body,
    };
  }
}
