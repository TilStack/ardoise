/**
 * Règles des relances automatiques — fonctions pures, sans base de données, testées unitairement.
 *
 *  - paliers J+3, J+7, J+14 comptés depuis le début de la période de dette ;
 *  - au plus 1 message par client toutes les 48 h (et pas dans les 48 h qui suivent un paiement) ;
 *  - envoi uniquement entre 8 h et 20 h, heure de Douala, à l'heure choisie par la boutique ;
 *  - chaque message contient le moyen de ne plus en recevoir.
 */

export const STEPS = [3, 7, 14] as const;
export const MIN_GAP_MS = 48 * 3_600_000;
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 20; // exclu : dernier envoi possible à 19 h 59
export const DEFAULT_SEND_HOUR = 9;
/** Le Cameroun est à UTC+1 toute l'année (pas d'heure d'été). */
export const DOUALA_OFFSET_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const DEFAULT_TEMPLATE = 'Bonjour {prénom}, petit rappel : {montant} FCFA à la {boutique}. Payez ici : {lien}';
/** Ajouté à chaque message : le lien ouvre la page de paiement, qui propose « Ne plus recevoir de rappels ». */
export const OPT_OUT_SUFFIX = ' Pour ne plus recevoir de rappels, ouvrez le même lien.';
export const TEMPLATE_MAX_LENGTH = 300;

// ---------------- Heure de Douala ----------------

export function doualaHour(t: Date): number {
  return new Date(t.getTime() + DOUALA_OFFSET_MS).getUTCHours();
}

/** Instant correspondant à `hour` h 00, heure de Douala, le jour (de Douala) de `t`, décalé de `addDays` jours. */
export function atDoualaHour(t: Date, hour: number, addDays = 0): Date {
  const local = new Date(t.getTime() + DOUALA_OFFSET_MS);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays);
  return new Date(midnightLocalAsUtc + hour * 3_600_000 - DOUALA_OFFSET_MS);
}

export function inSendWindow(t: Date): boolean {
  const h = doualaHour(t);
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

/** Premier instant d'envoi autorisé à partir de `t` : `t` lui-même s'il est dans la plage, sinon l'heure d'envoi suivante. */
export function nextSendable(t: Date, sendHour: number): Date {
  if (inSendWindow(t)) return t;
  return doualaHour(t) < WINDOW_START_HOUR ? atDoualaHour(t, sendHour) : atDoualaHour(t, sendHour, 1);
}

/** Date théorique d'un palier : J+step à l'heure d'envoi de la boutique. */
export function stepDueAt(cycleStart: Date, step: number, sendHour: number): Date {
  return atDoualaHour(cycleStart, sendHour, step);
}

// ---------------- Période de dette ----------------

export interface Movement {
  at: Date;
  /** Variation de la créance : + le client doit plus, − il a payé (ou une dette a été annulée). */
  delta: number;
  isPayment: boolean;
}

export interface DebtState {
  balance: number;
  /** Début de la période de dette en cours (null si le client ne doit rien). */
  cycleStart: Date | null;
  lastPaymentAt: Date | null;
}

/**
 * Rejoue les mouvements dans l'ordre : la période de dette commence quand le solde passe de ≤ 0 à > 0
 * et se termine quand il revient à ≤ 0. Un client qui achète tous les jours sans rien payer reste donc
 * dans la même période (ses relances ne sont pas repoussées à chaque achat).
 */
export function debtState(movements: Movement[]): DebtState {
  let balance = 0;
  let cycleStart: Date | null = null;
  let lastPaymentAt: Date | null = null;
  for (const m of movements) {
    const before = balance;
    balance += m.delta;
    if (before <= 0 && balance > 0) cycleStart = m.at;
    if (balance <= 0) cycleStart = null;
    if (m.isPayment && (!lastPaymentAt || m.at > lastPaymentAt)) lastPaymentAt = m.at;
  }
  return { balance, cycleStart, lastPaymentAt };
}

// ---------------- Choix du prochain palier ----------------

export interface PlanInput {
  cycleStart: Date;
  /** Paliers déjà traités dans cette période (envoyés, échoués ou ignorés). */
  doneSteps: number[];
  lastSentAt: Date | null;
  lastPaymentAt: Date | null;
  sendHour: number;
  now: Date;
}

/**
 * Prochain rappel à programmer, ou null si les 3 paliers sont passés.
 * Si plusieurs paliers sont déjà échus (service arrêté, relances réactivées…), on n'envoie que le plus
 * avancé : le client reçoit un seul message, pas un rattrapage en rafale.
 */
export function nextReminder(p: PlanInput): { step: number; scheduledAt: Date } | null {
  const maxDone = Math.max(0, ...p.doneSteps);
  const remaining = STEPS.filter((s) => s > maxDone);
  if (!remaining.length) return null;
  const overdue = remaining.filter((s) => stepDueAt(p.cycleStart, s, p.sendHour) <= p.now);
  const step = overdue.length ? overdue[overdue.length - 1] : remaining[0];
  const due = stepDueAt(p.cycleStart, step, p.sendHour).getTime();
  const earliest = Math.max(
    due,
    p.lastSentAt ? p.lastSentAt.getTime() + MIN_GAP_MS : 0,
    p.lastPaymentAt ? p.lastPaymentAt.getTime() + MIN_GAP_MS : 0,
  );
  // Palier déjà échu : tout de suite si on est dans la plage horaire, sinon à la prochaine heure d'envoi.
  if (earliest <= p.now.getTime()) return { step, scheduledAt: nextSendable(p.now, p.sendHour) };
  return { step, scheduledAt: nextSendable(new Date(earliest), p.sendHour) };
}

/** Raison de ne pas envoyer maintenant (contrôle refait au moment de l'envoi), avec la nouvelle date. */
export function deferral(now: Date, lastSentAt: Date | null, lastPaymentAt: Date | null, sendHour: number): Date | null {
  const earliest = Math.max(
    now.getTime(),
    lastSentAt ? lastSentAt.getTime() + MIN_GAP_MS : 0,
    lastPaymentAt ? lastPaymentAt.getTime() + MIN_GAP_MS : 0,
  );
  const at = nextSendable(new Date(earliest), sendHour);
  return at.getTime() > now.getTime() ? at : null;
}

// ---------------- Message ----------------

export function formatAmount(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ');
}

export function validateTemplate(t: string): string | null {
  if (!t.trim()) return 'Le message ne peut pas être vide';
  if (t.length > TEMPLATE_MAX_LENGTH) return `Message trop long (${TEMPLATE_MAX_LENGTH} caractères au plus)`;
  if (!t.includes('{lien}')) return 'Le message doit contenir {lien} : c’est par là que le client paie';
  const unknown = [...t.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((v) => !['prénom', 'prenom', 'montant', 'boutique', 'lien'].includes(v));
  if (unknown.length) return `Variable inconnue : {${unknown[0]}}`;
  return null;
}

export function renderMessage(template: string | null, v: { name: string; amount: number; shop: string | null; url: string }): string {
  const firstName = v.name.trim().split(/\s+/)[0] || v.name;
  const body = (template ?? DEFAULT_TEMPLATE)
    .replace(/\{pr[ée]nom\}/g, firstName)
    .replace(/\{montant\}/g, formatAmount(v.amount))
    .replace(/\{boutique\}/g, v.shop?.trim() || 'boutique')
    .replace(/\{lien\}/g, v.url);
  return body + OPT_OUT_SUFFIX;
}
