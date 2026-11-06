import { pool as defaultPool } from '../db/pool.js';

/** What the publish trigger remembers, on the single site_settings row (migration add_publish_state.js). */
export const publishRepository = {
  async getState(db = defaultPool) {
    const { rows } = await db.query(
      'SELECT publish_hook_fingerprint AS fingerprint, publish_hook_at AS "at", publish_hook_ok AS ok, publish_hook_message AS message FROM site_settings WHERE id = 1',
    );
    return rows[0] ?? { fingerprint: null, at: null, ok: null, message: null };
  },

  async saveHookResult({ fingerprint, ok, message }, db = defaultPool) {
    // The row exists on any real database (every column has a default); create it if a fresh one has none yet.
    await db.query('INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await db.query(
      'UPDATE site_settings SET publish_hook_fingerprint = $1, publish_hook_at = now(), publish_hook_ok = $2, publish_hook_message = $3 WHERE id = 1',
      [fingerprint, ok, String(message ?? '').slice(0, 200)],
    );
  },
};
