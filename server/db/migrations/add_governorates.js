import { pool as defaultPool } from '../pool.js';

export const CANONICAL_GOVERNORATES = [
  { id: 1, name: 'Tunis', code: 'TN-11' },
  { id: 2, name: 'Sousse', code: 'TN-51' },
  { id: 3, name: 'Nabeul', code: 'TN-21' },
  { id: 4, name: 'Ariana', code: 'TN-12' },
  { id: 5, name: 'Manouba', code: 'TN-14' },
  { id: 6, name: 'Monastir', code: 'TN-52' },
  { id: 7, name: 'Mahdia', code: 'TN-53' },
  { id: 8, name: 'Ben Arous', code: 'TN-13' },
  { id: 9, name: 'Bizerte', code: 'TN-23' },
  { id: 10, name: 'Kairouan', code: 'TN-41' },
  { id: 11, name: 'Sfax', code: 'TN-54' },
  { id: 12, name: 'Zaghouan', code: 'TN-22' },
  { id: 13, name: 'Beja', code: 'TN-31' },
  { id: 14, name: 'Gabes', code: 'TN-71' },
  { id: 15, name: 'Gafsa', code: 'TN-61' },
  { id: 16, name: 'Jendouba', code: 'TN-32' },
  { id: 17, name: 'Kasserine', code: 'TN-42' },
  { id: 18, name: 'Kebili', code: 'TN-63' },
  { id: 19, name: 'Kef', code: 'TN-33' },
  { id: 20, name: 'Medenine', code: 'TN-72' },
  { id: 21, name: 'Sidi Bouzid', code: 'TN-43' },
  { id: 22, name: 'Siliana', code: 'TN-34' },
  { id: 23, name: 'Tataouine', code: 'TN-73' },
  { id: 24, name: 'Tozeur', code: 'TN-62' },
];

/**
 * Migration:
 * 1. Creates governorates reference table
 * 2. Seeds the 24 canonical Tunisian governorates
 * 3. Safely executes one-time transactional order reset if orders.governorate_id does not exist
 * 4. Adds orders.governorate_id NOT NULL with Foreign Key constraint
 * 5. Creates index on orders.governorate_id
 */
export async function runGovernoratesMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    // 1. Create governorates reference table
    await client.query(`
      CREATE TABLE IF NOT EXISTS governorates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(64) NOT NULL UNIQUE,
        code VARCHAR(32) NOT NULL UNIQUE
      );
    `);

    // 2. Populate / ensure canonical 24 governorates
    for (const gov of CANONICAL_GOVERNORATES) {
      await client.query(`
        INSERT INTO governorates (id, name, code)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO UPDATE SET code = EXCLUDED.code;
      `, [gov.id, gov.name, gov.code]);
    }

    await client.query(`
      SELECT setval('governorates_id_seq', (SELECT COALESCE(MAX(id), 1) FROM governorates));
    `);

    // 3. Check if orders.governorate_id column already exists
    const { rows: colCheck } = await client.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'orders' AND column_name = 'governorate_id';
    `);

    const columnExists = colCheck.length > 0;

    if (!columnExists) {
      console.log('[migration:governorates] Column orders.governorate_id does not exist. Performing authorized order data reset...');

      // Capture pre-reset row counts for audit logging
      const getCount = async (t) => {
        try {
          const res = await client.query(`SELECT COUNT(*)::int as count FROM ${t}`);
          return res.rows[0].count;
        } catch {
          return 0;
        }
      };

      const countsBefore = {
        refund_items: await getCount('refund_items'),
        order_refunds: await getCount('order_refunds'),
        exchange_items: await getCount('exchange_items'),
        order_exchanges: await getCount('order_exchanges'),
        order_email_deliveries: await getCount('order_email_deliveries'),
        draft_conversions: await getCount('draft_conversions'),
        order_items: await getCount('order_items'),
        orders: await getCount('orders'),
      };

      console.log('[migration:governorates] Pre-reset counts:', JSON.stringify(countsBefore));

      // The reset below deletes every order. It only ever made sense for a database whose orders predate governorates;
      // on a database that holds orders it must never happen by accident (for example after restoring an old backup).
      if (countsBefore.orders > 0 && process.env.ALLOW_ORDER_RESET !== 'yes') {
        throw new Error(
          `Refusing to delete ${countsBefore.orders} order(s): orders.governorate_id is missing and this migration would wipe all orders. ` +
          'Restore a backup that already has the column, or, only if these orders may really be lost, start once with ALLOW_ORDER_RESET=yes.',
        );
      }

      // Reverse dependency deletion
      await client.query('DELETE FROM refund_items');
      await client.query('DELETE FROM order_refunds');
      await client.query('DELETE FROM exchange_items');
      await client.query('DELETE FROM order_exchanges');
      await client.query('DELETE FROM order_email_deliveries');
      await client.query('DELETE FROM draft_conversions');
      await client.query('DELETE FROM order_items');

      // Unlink or delete order-specific notifications & idempotency records
      await client.query('DELETE FROM admin_notifications WHERE order_id IS NOT NULL');
      await client.query('DELETE FROM idempotency_keys WHERE order_id IS NOT NULL');
      await client.query('UPDATE analytics_events SET order_id = NULL WHERE order_id IS NOT NULL');
      await client.query('UPDATE drafts SET converted_order_id = NULL WHERE converted_order_id IS NOT NULL');

      // Finally delete orders
      await client.query('DELETE FROM orders');

      console.log('[migration:governorates] Order data reset complete. Adding orders.governorate_id column...');

      // 4. Add orders.governorate_id NOT NULL REFERENCES governorates(id)
      await client.query(`
        ALTER TABLE orders 
        ADD COLUMN governorate_id INTEGER NOT NULL REFERENCES governorates(id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_governorate_id ON orders(governorate_id);
      `);

      console.log('[migration:governorates] Column orders.governorate_id added with NOT NULL and FK.');
    } else {
      // Column already exists. Ensure NOT NULL, FK and index exist
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'orders_governorate_id_governorates_id_fk' 
               OR constraint_name = 'fk_orders_governorate'
          ) THEN
            ALTER TABLE orders 
            ADD CONSTRAINT fk_orders_governorate 
            FOREIGN KEY (governorate_id) REFERENCES governorates(id);
          END IF;
        END $$;
      `);

      await client.query(`
        ALTER TABLE orders ALTER COLUMN governorate_id SET NOT NULL;
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_governorate_id ON orders(governorate_id);
      `);
    }

    await client.query('COMMIT');
    console.log('[migration:governorates] Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migration:governorates] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
