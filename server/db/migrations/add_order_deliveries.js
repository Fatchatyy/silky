import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration for GOODEX delivery tracking.
 * Safe to run multiple times without error.
 */
export async function runOrderDeliveriesMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        provider VARCHAR(32) NOT NULL DEFAULT 'goodex',
        state VARCHAR(16) NOT NULL DEFAULT 'creating',
        ean VARCHAR(64),
        cod_amount NUMERIC(10,3),
        claimed_at TIMESTAMPTZ,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        goodex_status VARCHAR(100),
        delivery_status VARCHAR(32),
        motif TEXT,
        status_updated_at TIMESTAMPTZ,
        last_webhook_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'order_deliveries_state_valid'
        ) THEN
          ALTER TABLE order_deliveries
          ADD CONSTRAINT order_deliveries_state_valid
          CHECK (state IN ('creating', 'created', 'failed', 'unknown'));
        END IF;
      END $$;
    `);

    // Added after the first release of this table: official GOODEX status id, when the
    // reason was last received, when the parcel was last polled, and the "Colis Introuvable"
    // tracking answer (kept apart so it never overwrites a valid saved status).
    await client.query(`
      ALTER TABLE order_deliveries
        ADD COLUMN IF NOT EXISTS goodex_status_id SMALLINT,
        ADD COLUMN IF NOT EXISTS motif_updated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS tracking_not_found_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS goodex_parcel_id BIGINT,
        ADD COLUMN IF NOT EXISTS goodex_created_at VARCHAR(32),
        ADD COLUMN IF NOT EXISTS has_motif BOOLEAN,
        ADD COLUMN IF NOT EXISTS status_received_at TIMESTAMPTZ;
    `);

    // Rows that already hold a status get the best receipt time we have for it.
    await client.query(`
      UPDATE order_deliveries
         SET status_received_at = COALESCE(last_webhook_at, last_polled_at, status_updated_at)
       WHERE status_received_at IS NULL AND goodex_status IS NOT NULL;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'order_deliveries_status_id_valid'
        ) THEN
          ALTER TABLE order_deliveries
          ADD CONSTRAINT order_deliveries_status_id_valid
          CHECK (goodex_status_id IS NULL OR goodex_status_id BETWEEN 1 AND 20);
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_deliveries_ean
        ON order_deliveries (ean)
        WHERE ean IS NOT NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_delivery_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        delivery_id UUID NOT NULL REFERENCES order_deliveries(id) ON DELETE CASCADE,
        source VARCHAR(16) NOT NULL,
        goodex_status VARCHAR(100),
        motif TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_order_delivery_events_delivery
        ON order_delivery_events (delivery_id, created_at);
    `);

    await client.query(`
      ALTER TABLE order_delivery_events
        ADD COLUMN IF NOT EXISTS goodex_status_id SMALLINT;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
