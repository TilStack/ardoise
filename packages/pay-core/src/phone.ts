import type { Operator } from './types';

/**
 * Numéros mobiles camerounais : 9 chiffres commençant par 6, indicatif +237.
 * Plages d'opérateurs (à confirmer auprès de l'ART avant production, elles évoluent) :
 *  - MTN    : 650-654, 670-679, 680-684
 *  - Orange : 640, 655-659, 686-689, 690-699
 * La détection sert seulement de valeur par défaut : le client peut toujours choisir son opérateur.
 */
const MTN = [/^65[0-4]/, /^67\d/, /^68[0-4]/];
const ORANGE = [/^640/, /^65[5-9]/, /^68[6-9]/, /^69\d/];

export class InvalidPhoneError extends Error {
  constructor(input: string) {
    super(`Numéro camerounais invalide : ${input}`);
    this.name = 'InvalidPhoneError';
  }
}

/** Retourne le numéro au format E.164 (+2376XXXXXXXX) ou lève InvalidPhoneError. */
export function normalizeCmPhone(input: string): string {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('237') && digits.length === 12) digits = digits.slice(3);
  if (!/^6\d{8}$/.test(digits)) throw new InvalidPhoneError(input);
  return `+237${digits}`;
}

export function detectOperator(phone: string): Operator | null {
  const local = normalizeCmPhone(phone).slice(4);
  if (MTN.some((r) => r.test(local))) return 'MTN';
  if (ORANGE.some((r) => r.test(local))) return 'ORANGE';
  return null;
}

/** Masque un numéro pour l'affichage : +237 6 77 •• •• 56 */
export function maskPhone(phone: string): string {
  const l = normalizeCmPhone(phone).slice(4);
  return `+237 ${l[0]} ${l.slice(1, 3)} •• •• ${l.slice(7)}`;
}
