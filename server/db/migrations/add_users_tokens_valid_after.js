import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration for the users table.
 * Adds tokens_valid_after: login tokens issued before this moment are refused (set by admin logout and
 * by every password change/reset). NULL means no token has been revoked.
 * Safe to run multiple times without error.
 */
export async function runUsersTokensValidAfterMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
