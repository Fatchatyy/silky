import { CLAIM_MESSAGE_MAX } from '../config/goodex.js';

/**
 * Validation of a claim request against the GOODEX claim-type definitions (the types
 * endpoint is documented as the exact list the server enforces, so nothing is hardcoded
 * per type). Formats follow the documented value_type rules:
 *  - montant:   decimal amount, e.g. 85.000
 *  - telephone: 8 to 20 digits
 *  - date:      YYYY-MM-DD, today or later
 *  - texte:     5 to 255 characters
 * An unrecognized value_type is only checked for presence and the 255-character ceiling;
 * GOODEX remains the judge of anything else.
 */

const pad = (n) => String(n).padStart(2, '0');

export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isRealDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function validateValue(valueType, raw, now = new Date()) {
  switch (valueType) {
    case 'montant': {
      const normalized = raw.replace(',', '.');
      if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return { error: 'Montant invalide : un nombre décimal est attendu (ex. 85.000)' };
      return { value: Number(normalized).toFixed(3) };
    }
    case 'telephone': {
      const digits = raw.replace(/[\s.-]/g, '');
      if (!/^\d{8,20}$/.test(digits)) return { error: 'Numéro de téléphone invalide : 8 à 20 chiffres attendus' };
      return { value: digits };
    }
    case 'date': {
      if (!isRealDate(raw)) return { error: 'Date invalide : le format attendu est AAAA-MM-JJ' };
      if (raw < todayLocal(now)) return { error: "La date doit être aujourd'hui ou une date future" };
      return { value: raw };
    }
    case 'texte': {
      if (raw.length < 5 || raw.length > 255) return { error: 'Le texte doit contenir entre 5 et 255 caractères' };
      return { value: raw };
    }
    default:
      if (raw.length > 255) return { error: 'La valeur ne doit pas dépasser 255 caractères' };
      return { value: raw };
  }
}

/** Returns { errors, clean }: field -> messages, and the normalized request when valid. */
export function validateClaimInput(input, types, now = new Date()) {
  const errors = {};
  const type = typeof input?.type === 'string' ? input.type.trim() : '';
  const def = types.find((t) => t.code === type);
  if (!def) return { errors: { type: ['Type de réclamation invalide'] }, clean: null };

  const rawValeur = input.valeur === undefined || input.valeur === null ? '' : String(input.valeur).trim();
  const rawMessage = typeof input.message === 'string' ? input.message.trim() : '';

  // valeur is only sent when the type needs one (it is not universally required).
  let valeur = null;
  if (def.needsValue) {
    if (!rawValeur) {
      errors.valeur = ['Cette information est obligatoire pour ce motif'];
    } else {
      const result = validateValue(def.valueType, rawValeur, now);
      if (result.error) errors.valeur = [result.error];
      else valeur = result.value;
    }
  }

  let message = null;
  if (def.messageRequired && !rawMessage) errors.message = ['Un message est obligatoire pour ce motif'];
  if (rawMessage) {
    if (rawMessage.length > CLAIM_MESSAGE_MAX) errors.message = [`Le message ne doit pas dépasser ${CLAIM_MESSAGE_MAX} caractères`];
    else message = rawMessage;
  }

  return { errors, clean: Object.keys(errors).length ? null : { type, valeur, message, def } };
}
