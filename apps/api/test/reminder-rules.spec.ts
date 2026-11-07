import {
  atDoualaHour,
  debtState,
  deferral,
  doualaHour,
  inSendWindow,
  nextReminder,
  nextSendable,
  OPT_OUT_SUFFIX,
  renderMessage,
  stepDueAt,
  validateTemplate,
} from '../src/reminders/rules';

const utc = (s: string) => new Date(`${s}Z`);

describe('Relances : règles (heure de Douala, paliers, plafond, message)', () => {
  it('calcule l’heure de Douala (UTC+1 toute l’année)', () => {
    expect(doualaHour(utc('2026-11-06T07:00:00'))).toBe(8);
    expect(atDoualaHour(utc('2026-11-06T22:30:00'), 9)).toEqual(utc('2026-11-06T08:00:00')); // 23 h 30 à Douala, même jour
    expect(atDoualaHour(utc('2026-11-06T23:30:00'), 9)).toEqual(utc('2026-11-07T08:00:00')); // 0 h 30 à Douala, lendemain
    expect(atDoualaHour(utc('2026-12-31T12:00:00'), 9, 3)).toEqual(utc('2027-01-03T08:00:00'));
  });

  it('n’envoie qu’entre 8 h et 20 h', () => {
    expect(inSendWindow(utc('2026-11-06T06:59:00'))).toBe(false); // 7 h 59
    expect(inSendWindow(utc('2026-11-06T07:00:00'))).toBe(true); // 8 h
    expect(inSendWindow(utc('2026-11-06T18:59:00'))).toBe(true); // 19 h 59
    expect(inSendWindow(utc('2026-11-06T19:00:00'))).toBe(false); // 20 h
    expect(nextSendable(utc('2026-11-06T19:30:00'), 9)).toEqual(utc('2026-11-07T08:00:00')); // 20 h 30 → lendemain 9 h
    expect(nextSendable(utc('2026-11-06T05:00:00'), 9)).toEqual(utc('2026-11-06T08:00:00')); // 6 h → 9 h le jour même
    expect(nextSendable(utc('2026-11-06T13:00:00'), 9)).toEqual(utc('2026-11-06T13:00:00'));
  });

  it('période de dette : commence quand le solde devient positif, pas à chaque achat', () => {
    const d = (day: number) => utc(`2026-10-${String(day).padStart(2, '0')}T10:00:00`);
    const s = debtState([
      { at: d(1), delta: 5000, isPayment: false },
      { at: d(2), delta: 2000, isPayment: false },
      { at: d(3), delta: -3000, isPayment: true },
    ]);
    expect(s).toEqual({ balance: 4000, cycleStart: d(1), lastPaymentAt: d(3) });

    const reset = debtState([
      { at: d(1), delta: 5000, isPayment: false },
      { at: d(4), delta: -5000, isPayment: true },
      { at: d(10), delta: 1500, isPayment: false },
    ]);
    expect(reset.cycleStart).toEqual(d(10));
    expect(debtState([{ at: d(1), delta: 1000, isPayment: false }, { at: d(2), delta: -1000, isPayment: true }]).cycleStart).toBeNull();
  });

  describe('prochain palier', () => {
    const start = utc('2026-10-01T09:30:00'); // 10 h 30 à Douala
    const base = { cycleStart: start, doneSteps: [], lastSentAt: null, lastPaymentAt: null, sendHour: 9 };

    it('J+3 à l’heure d’envoi, puis J+7, puis J+14, puis plus rien', () => {
      expect(nextReminder({ ...base, now: start })).toEqual({ step: 3, scheduledAt: utc('2026-10-04T08:00:00') });
      expect(nextReminder({ ...base, doneSteps: [3], now: start })?.step).toBe(7);
      expect(nextReminder({ ...base, doneSteps: [3, 7], now: start })).toEqual({ step: 14, scheduledAt: stepDueAt(start, 14, 9) });
      expect(nextReminder({ ...base, doneSteps: [3, 7, 14], now: start })).toBeNull();
    });

    it('rattrapage : un seul message (le palier le plus avancé), jamais une rafale', () => {
      expect(nextReminder({ ...base, now: utc('2026-10-10T12:00:00') })?.step).toBe(7);
      expect(nextReminder({ ...base, now: utc('2026-10-20T12:00:00') })?.step).toBe(14);
      // échu, mais il est 21 h 30 : pas d'envoi à 8 h le lendemain, à l'heure de la boutique (9 h)
      expect(nextReminder({ ...base, now: utc('2026-10-10T20:30:00') })).toEqual({ step: 7, scheduledAt: utc('2026-10-11T08:00:00') });
    });

    it('48 h minimum après le dernier message et après un paiement', () => {
      const lastSentAt = utc('2026-10-07T13:00:00');
      expect(nextReminder({ ...base, doneSteps: [3], lastSentAt, now: lastSentAt })?.scheduledAt).toEqual(utc('2026-10-09T13:00:00'));
      const close = nextReminder({ ...base, doneSteps: [3, 7], lastSentAt: utc('2026-10-14T07:30:00'), now: utc('2026-10-14T07:30:00') });
      expect(close?.scheduledAt).toEqual(utc('2026-10-16T07:30:00'));
      const paid = nextReminder({ ...base, lastPaymentAt: utc('2026-10-03T18:00:00'), now: utc('2026-10-03T18:00:00') });
      expect(paid?.scheduledAt).toEqual(utc('2026-10-05T18:00:00'));
      // 48 h tombant à 21 h → reporté au lendemain à l'heure d'envoi
      const late = nextReminder({ ...base, lastPaymentAt: utc('2026-10-03T20:00:00'), now: utc('2026-10-03T20:00:00') });
      expect(late?.scheduledAt).toEqual(utc('2026-10-06T08:00:00'));
    });

    it('au moment d’envoyer : report si un message ou un paiement date de moins de 48 h', () => {
      const now = utc('2026-10-08T08:00:00');
      expect(deferral(now, null, null, 9)).toBeNull();
      expect(deferral(now, utc('2026-10-07T08:00:00'), null, 9)).toEqual(utc('2026-10-09T08:00:00'));
      expect(deferral(utc('2026-10-08T20:00:00'), null, null, 9)).toEqual(utc('2026-10-09T08:00:00'));
    });
  });

  describe('message', () => {
    it('modèle par défaut, prénom, montant lisible, mention de désinscription', () => {
      const m = renderMessage(null, { name: 'Paul Ngono', amount: 12500, shop: 'Boutique Brigitte', url: 'https://pay.test/p/abc' });
      expect(m).toBe(`Bonjour Paul, petit rappel : 12 500 FCFA à la Boutique Brigitte. Payez ici : https://pay.test/p/abc${OPT_OUT_SUFFIX}`);
    });

    it('modèle personnalisé validé : {lien} obligatoire, variables connues, 300 caractères', () => {
      expect(validateTemplate('Payez svp')).toMatch(/\{lien\}/);
      expect(validateTemplate('Bonjour {nom} : {lien}')).toMatch(/inconnue/);
      expect(validateTemplate('x'.repeat(301) + '{lien}')).toMatch(/trop long/);
      expect(validateTemplate('Salut {prenom}, {montant} F chez {boutique} : {lien}')).toBeNull();
      expect(renderMessage('Salut {prenom}, {montant} F : {lien}', { name: 'Éric', amount: 800, shop: null, url: 'u' })).toMatch(/^Salut Éric, 800 F : u/);
    });
  });
});
