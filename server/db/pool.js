import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// connectionTimeoutMillis: a request waits at most 30 s for a free connection (or for the database to answer) and then
// fails, instead of waiting forever when the database is unreachable.
export const pool = new Pool({
  connectionString: env.databaseUrl,
  connectionTimeoutMillis: env.dbConnectionTimeoutMs,
  max: env.dbPoolMax,
  ...(env.dbStatementTimeoutMs > 0 ? { statement_timeout: env.dbStatementTimeoutMs } : {}),
});

// An idle connection can break (database restart, network drop). The pool reports it as an 'error' event; with no
// listener Node stops the whole process. The broken connection is discarded by the pool and a new one is opened on demand.
pool.on('error', (err) => {
  console.error('[db] Idle database connection error:', err.message);
});

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function verifyConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
