/**
 * Creates the Silky tables in a NEW, EMPTY database (npm run db:init): applies server/db/schema.sql.
 *
 * Safe by design:
 *  - it refuses to touch a database that already has any table, so it can never overwrite or wipe data;
 *  - everything runs in one transaction (all or nothing).
 * Afterwards: start the server once (its startup migrations fill the governorates list and keep the schema current),
 * then create the admin account with `npm run admin:create`.
 *
 * Usage: DATABASE_URL=postgres://user:pass@host:5432/silky npm run db:init
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '../../.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const target = new URL(url);
console.log(`Target database: "${decodeURIComponent(target.pathname.slice(1))}" on ${target.hostname}:${target.port || 5432}`);

// One dedicated connection: the schema file changes the session's search_path, which must not leak into a shared pool.
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const { rows: [{ count }] } = await client.query(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
  );
  if (count > 0) {
    console.error(`Refusing to continue: this database already has ${count} table(s). db:init only works on an empty database.`);
    process.exitCode = 1;
  } else {
    const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    const { rows: [{ count: created }] } = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    console.log(`Done: ${created} tables created.`);
    console.log('Next: start the server once (npm start), then run: npm run admin:create');
  }
} catch (err) {
  console.error('db:init failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
