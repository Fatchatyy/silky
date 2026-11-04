/**
 * Real user rows for the tokens a test signs by hand. Tokens are checked against the database (the account must
 * exist, its role is the stored one), so a test that needs an admin or customer token creates the account here and
 * removes it at the end. The pool is passed in so this file loads nothing before a test's database guard has run.
 */
import crypto from 'node:crypto';

const created = [];

export async function createAccount(pool, role, label) {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users (id, email, password_hash, role, full_name) VALUES ($1, $2, 'x', $3, $4)",
    [id, `${label}-${role}-${id.slice(0, 8)}@test.invalid`, role, `Test ${role}`],
  );
  created.push(id);
  return id;
}

export async function removeAccounts(pool) {
  if (created.length) await pool.query('DELETE FROM users WHERE id = ANY($1)', [created.splice(0)]);
}
