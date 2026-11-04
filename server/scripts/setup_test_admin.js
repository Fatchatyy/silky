/**
 * Idempotent test-database setup: makes sure the admin account that the app's admin panel login
 * looks up (ADMIN_EMAIL / ADMIN_PASSWORD, same values and role as `db:seed`) exists.
 *
 * Why not `npm run db:seed`: the seed TRUNCATEs users, orders, products, categories ... with
 * CASCADE (it wipes the whole database, including the GOODEX tables) and its demo orders no
 * longer satisfy the NOT NULL governorate_id, so it cannot be re-run safely.
 *
 * This script only INSERTs the admin row when no user with that email exists, and never
 * touches any other row. It refuses to run unless the connected database is named exactly
 * like a test database (contains "test") and is not "silky".
 *
 * Usage: DATABASE_URL=postgres://.../silky_test node server/scripts/setup_test_admin.js
 */
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

const urlName = new URL(env.databaseUrl).pathname.slice(1);
if (!/test/i.test(urlName) || urlName === 'silky') {
  console.error(`Refusing to run: DATABASE_URL targets "${urlName}", a dedicated test database (name containing "test") is required.`);
  process.exit(1);
}

try {
  const { rows: [current] } = await pool.query('select current_database() as db');
  if (current.db !== urlName || !/test/i.test(current.db)) {
    throw new Error(`Connected database "${current.db}" does not match the expected test database "${urlName}"`);
  }

  const { rows: existing } = await pool.query('select id, role from users where email = $1', [env.adminEmail]);
  if (existing.length) {
    console.log(`[${current.db}] a user with the configured ADMIN_EMAIL already exists (role: ${existing[0].role}); nothing changed.`);
    process.exitCode = existing[0].role === 'admin' ? 0 : 1;
  } else {
    const hash = await bcrypt.hash(env.adminPassword, 12);
    await pool.query(
      `insert into users (email, password_hash, role, full_name, phone_number) values ($1, $2, 'admin', 'Silky Admin', '20000000')`,
      [env.adminEmail, hash],
    );
    console.log(`[${current.db}] admin account created for the configured ADMIN_EMAIL (same fields as db:seed).`);
  }
} catch (err) {
  console.error('Setup failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
