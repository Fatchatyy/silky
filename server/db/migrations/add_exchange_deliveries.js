import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration: GOODEX parcels for exchanges.
 *
 *  - order_exchanges.decharge: the admin's explicit answer at exchange time (true = the
 *    customer already received the article being exchanged, false = still in transit).
 *    NULL for exchanges created before this column existed.
 *  - order_deliveries.exchange_id: set on the delivery row of an exchange parcel, NULL on
 *    the ordinary order parcel. order_id stays NOT NULL on both.
 *  - order_deliveries was UNIQUE (order_id), which allowed one parcel per order. That
 *    constraint becomes a partial unique index on the ordinary rows (exchange_id IS NULL),
 *    and exchange rows are unique per exchange_id instead. Existing rows are untouched.
 *
 * Needs order_exchanges and order_deliveries to exist (run after their migrations).
 * Safe to run multiple times without error.
 */
export async function runExchangeDeliveriesMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE order_exchanges
        ADD COLUMN IF NOT EXISTS decharge BOOLEAN;
    `);

    await client.query(`
      ALTER TABLE order_deliveries
        ADD COLUMN IF NOT EXISTS exchange_id UUID REFERENCES order_exchanges(id) ON DELETE CASCADE;
    `);

    // The old single-column UNIQUE (order_id) may carry either name depending on whether the
    // table came from the startup migration or from drizzle, so it is found by its columns.
    await client.query(`
      DO $$
      DECLARE
        con RECORD;
      BEGIN
        FOR con IN
          SELECT c.conname
            FROM pg_constraint c
           WHERE c.conrelid = 'order_deliveries'::regclass
             AND c.contype = 'u'
             AND c.conkey = ARRAY[
               (SELECT a.attnum FROM pg_attribute a
                 WHERE a.attrelid = 'order_deliveries'::regclass AND a.attname = 'order_id')
             ]
        LOOP
          EXECUTE format('ALTER TABLE order_deliveries DROP CONSTRAINT %I', con.conname);
        END LOOP;
      END $$;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_deliveries_order_ordinary
        ON order_deliveries (order_id)
        WHERE exchange_id IS NULL;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_deliveries_exchange
        ON order_deliveries (exchange_id)
        WHERE exchange_id IS NOT NULL;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
