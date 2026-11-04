/**
 * Creates the admin account the admin panel logs in with (npm run admin:create).
 *
 * The panel asks only for the password (ADMIN_PASSWORD), but the server needs a user row with the role "admin" for
 * ADMIN_EMAIL to issue the session. This script inserts exactly that one row:
 *  - it never changes or deletes anything else (unlike db:seed, which wipes tables and must not be run on a live shop);
 *  - if the admin already exists it does nothing; if a customer already uses that e-mail it stops and says so.
 * In production it uses the same checks as the server (strong ADMIN_PASSWORD, ...).
 *
 * Usage: set the same environment as the server, then: npm run admin:create
 */
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import { pool } from './pool.js';

const email = env.adminEmail.trim().toLowerCase();

try {
  const { rows } = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
  if (rows.length) {
    if (rows[0].role === 'admin') {
      console.log(`The admin account for ${email} already exists. Nothing changed.`);
    } else {
      console.error(`${email} belongs to a customer account (role "${rows[0].role}"). Choose another ADMIN_EMAIL; nothing changed.`);
      process.exitCode = 1;
    }
  } else {
    // Admin login checks ADMIN_PASSWORD from the environment, not this hash; the column just may not be empty.
    const passwordHash = await bcrypt.hash(env.adminPassword, 12);
    await pool.query(
      "INSERT INTO users (email, password_hash, role, full_name) VALUES ($1, $2, 'admin', 'Silky Admin')",
      [email, passwordHash],
    );
    console.log(`Admin account created for ${email}. Log in to the admin panel with ADMIN_PASSWORD.`);
  }
} catch (err) {
  console.error('admin:create failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
