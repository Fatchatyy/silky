import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent migration: what the publish trigger remembers (services/publish.service.js) lives on the single
 * site_settings row: the fingerprint of the catalogue the deploy hook was last called for, when, and how it went.
 * Safe to run multiple times.
 */
export async function runPublishStateMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE site_settings
      ADD COLUMN IF NOT EXISTS publish_hook_fingerprint TEXT,
      ADD COLUMN IF NOT EXISTS publish_hook_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS publish_hook_ok BOOLEAN,
      ADD COLUMN IF NOT EXISTS publish_hook_message TEXT,
      ADD COLUMN IF NOT EXISTS publish_month TEXT,
      ADD COLUMN IF NOT EXISTS publish_month_count INTEGER;
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
