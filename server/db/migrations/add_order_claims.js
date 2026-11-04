import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration for GOODEX delivery claims (tickets).
 * Safe to run multiple times without error.
 */
export async function runOrderClaimsMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_claims (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        ean VARCHAR(64) NOT NULL,
        goodex_claim_id BIGINT NOT NULL UNIQUE,
        reference VARCHAR(64),
        type VARCHAR(64),
        type_label VARCHAR(160),
        valeur VARCHAR(255),
        message TEXT,
        status VARCHAR(32),
        priorite VARCHAR(32),
        is_open BOOLEAN NOT NULL DEFAULT TRUE,
        reponse TEXT,
        goodex_created_at VARCHAR(40),
        resolved_at VARCHAR(40),
        cancelled_at TIMESTAMPTZ,
        last_synced_at TIMESTAMPTZ,
        source VARCHAR(16) NOT NULL DEFAULT 'silky',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_order_claims_order ON order_claims (order_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_order_claims_ean ON order_claims (ean);
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
