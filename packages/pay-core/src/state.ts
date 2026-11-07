import type { TxStatus } from './types';

const FINAL: ReadonlySet<TxStatus> = new Set(['SUCCESS', 'FAILED', 'EXPIRED']);

const ALLOWED: Record<TxStatus, readonly TxStatus[]> = {
  CREATED: ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'],
  PENDING: ['SUCCESS', 'FAILED', 'EXPIRED'],
  SUCCESS: [],
  FAILED: [],
  EXPIRED: [],
};

export function isFinal(status: TxStatus): boolean {
  return FINAL.has(status);
}

export function canTransition(from: TxStatus, to: TxStatus): boolean {
  if (from === to) return false;
  return ALLOWED[from].includes(to);
}

/** Durée de vie d'une demande de paiement avant expiration (spec : 15 min). */
export const PAYMENT_TTL_MS = 15 * 60 * 1000;

/** Délai sans webhook avant que la tâche de rattrapage interroge le fournisseur (spec : 5 min). */
export const RECOVERY_AFTER_MS = 5 * 60 * 1000;
