/** Montants en francs CFA (XAF), toujours des entiers : le FCFA n'a pas de centimes. */
export type Currency = 'XAF';

export type Operator = 'MTN' | 'ORANGE';

/**
 * Statuts d'une transaction côté plateforme.
 * CREATED → PENDING → SUCCESS | FAILED | EXPIRED. Un statut final ne change plus.
 */
export type TxStatus = 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

export interface InitiateInput {
  /** Référence générée par L'Ardoise : sert de clé d'idempotence chez le fournisseur. */
  reference: string;
  amount: number;
  currency: Currency;
  /** Numéro E.164, ex. +237677123456 */
  phone: string;
  operator: Operator;
  description: string;
  customerName?: string;
  customerEmail?: string;
  callbackUrl?: string;
}

export interface InitiateResult {
  providerRef: string;
  status: TxStatus;
  raw: unknown;
}

export interface StatusResult {
  providerRef: string;
  status: TxStatus;
  amount: number;
  currency: string;
  raw: unknown;
}

export interface WebhookEvent {
  providerRef: string;
  /** Référence marchande (la nôtre), si le fournisseur la renvoie. */
  merchantReference?: string;
  /** Statut annoncé par le webhook : indicatif, toujours re-vérifié via getStatus(). */
  announcedStatus?: TxStatus;
  raw: unknown;
}

export type Headers = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  readonly name: string;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  getStatus(providerRef: string): Promise<StatusResult>;
  /** Vérifie la signature du webhook sur le corps BRUT (avant tout JSON.parse). */
  verifyWebhook(rawBody: Buffer | string, headers: Headers): boolean;
  parseWebhook(rawBody: Buffer | string): WebhookEvent;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly httpStatus?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
