import { pool as defaultPool } from '../db/pool.js';

/**
 * What the publish button remembers, on the single site_settings row (migrations add_publish_state.js): the fingerprint of the
 * catalogue the deploy hook was last called for, when, and how it went, plus how many calls the hook accepted in the current month.
 */
export const publishRepository = {
  async getState(db = defaultPool) {
    const { rows } = await db.query(
      `SELECT publish_hook_fingerprint AS fingerprint, publish_hook_at AS "at", publish_hook_ok AS ok, publish_hook_message AS message,
              publish_month AS month, COALESCE(publish_month_count, 0) AS "monthCount"
         FROM site_settings WHERE id = 1`,
    );
    return rows[0] ?? { fingerprint: null, at: null, ok: null, message: null, month: null, monthCount: 0 };
  },

  /** Remembers the outcome of a call; an accepted one also adds 1 to this month's count (the count starts again each month, UTC). */
  async saveHookResult({ fingerprint, ok, message }, db = defaultPool) {
    const month = new Date().toISOString().slice(0, 7);
    // The row exists on any real database (every column has a default); create it if a fresh one has none yet.
    await db.query('INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await db.query(
      `UPDATE site_settings SET
         publish_hook_fingerprint = $1, publish_hook_at = now(), publish_hook_ok = $2, publish_hook_message = $3,
         publish_month_count = CASE WHEN publish_month IS NOT DISTINCT FROM $4 THEN COALESCE(publish_month_count, 0) + $5 ELSE $5 END,
         publish_month = $4
       WHERE id = 1`,
      [fingerprint, ok, String(message ?? '').slice(0, 200), month, ok ? 1 : 0],
    );
  },
};
