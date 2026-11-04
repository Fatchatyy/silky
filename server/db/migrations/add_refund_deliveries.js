import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration: GOODEX parcels for refunds (Remboursement / Remboursement gratuit).
 *
 *  - order_deliveries.refund_id: set on the delivery row of a refund parcel, NULL on the ordinary
 *    order parcel and on exchange parcels. order_id stays NOT NULL on every row.
 *  - The ordinary-parcel unique index (one per order) now only covers rows that belong to neither
 *    an exchange nor a refund; refund rows are unique per refund_id instead. Existing rows are
 *    untouched.
 *  - A row belongs to an exchange or to a refund, never to both.
 *
 * Needs order_refunds and order_deliveries (and add_exchange_deliveries) to exist, so it runs after
 * their migrations. Safe to run multiple times without error.
 */
export async function runRefundDeliveriesMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE order_deliveries
        ADD COLUMN IF NOT EXISTS refund_id UUID REFERENCES order_refunds(id) ON DELETE CASCADE;
    `);

    // Recreated with the wider predicate. Dropping and creating happen in the same transaction,
    // so there is no moment without the one-parcel-per-order guarantee.
    await client.query('DROP INDEX IF EXISTS idx_order_deliveries_order_ordinary;');
    await client.query(`
      CREATE UNIQUE INDEX idx_order_deliveries_order_ordinary
        ON order_deliveries (order_id)
        WHERE exchange_id IS NULL AND refund_id IS NULL;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_deliveries_refund
        ON order_deliveries (refund_id)
        WHERE refund_id IS NOT NULL;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'order_deliveries'::regclass
             AND conname = 'order_deliveries_one_owner'
        ) THEN
          ALTER TABLE order_deliveries
            ADD CONSTRAINT order_deliveries_one_owner
            CHECK (exchange_id IS NULL OR refund_id IS NULL);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
