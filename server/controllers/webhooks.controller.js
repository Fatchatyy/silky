import crypto from 'crypto';
import { env } from '../config/env.js';
import * as deliveryService from '../services/delivery.service.js';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

/** Constant-time check of "Authorization: Bearer <secret>" against the webhook secret. */
function hasValidBearer(header, secret) {
  const match = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!match) return false;
  return crypto.timingSafeEqual(sha256(match[1].trim()), sha256(secret));
}

export async function goodexWebhook(req, res) {
  const secret = env.goodex.webhookSecret;
  if (!secret) {
    // Fail closed: without a configured secret nothing can be authenticated.
    return res.status(503).json({ error: 'Webhook non configuré (GOODEX_WEBHOOK_SECRET manquant)' });
  }
  if (!hasValidBearer(req.headers.authorization, secret)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Corps invalide' });
  }
  if (body.test === true || body.test === 'true') {
    return res.json({ ok: true, ignored: 'test' });
  }

  // The payload's field types are not specified beyond the example; tolerate a numeric code.
  const rawCode = typeof body.code === 'number' && Number.isSafeInteger(body.code) ? String(body.code) : body.code;
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  // Documented as text; an integer is tolerated and resolved as an official status id.
  const rawStatut = Number.isSafeInteger(body.statut) ? String(body.statut) : body.statut;
  const statut = typeof rawStatut === 'string' ? rawStatut.trim() : '';
  if (!code || code.length > 64 || !statut || statut.length > 100) {
    return res.status(400).json({ error: 'code et statut requis' });
  }
  const motif = typeof body.motif === 'string' && body.motif.trim() ? body.motif.trim().slice(0, 1000) : null;

  try {
    const { result } = await deliveryService.applyWebhook({ code, statut, motif });
    if (result === 'unknown_code') {
      console.warn('[webhook] GOODEX notification for an unknown parcel code');
    }
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('[webhook] Failed to apply GOODEX notification:', err.message);
    // 5xx lets GOODEX retry if it supports that.
    return res.status(500).json({ error: 'Erreur interne' });
  }
}
