/**
 * Safety of the server configuration and process (no database, no network):
 *  - NODE_ENV must be production | development | test, anything else stops the server with a clear error;
 *  - the "forgot password" reset token can be exposed only in development, only when EXPOSE_RESET_TOKEN=true, never in production;
 *  - in production without SMTP credentials e-mail is off (no Ethereal fallback, no customer data sent to a test service);
 *  - the last-resort process handlers and the database pool error handler / connection timeout exist.
 *
 * Usage: node server/scripts/test_env_safety.js
 */
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

/** The JSON the child printed (dotenv may print its own notice line first). */
const lastJson = (out) => JSON.parse(out.trim().split('\n').filter((line) => line.startsWith('{')).pop());

/** Runs `code` (ES module source) in a fresh node process with exactly these variables on top of a clean base. */
function run(code, vars) {
  const base = { ...process.env };
  for (const key of ['NODE_ENV', 'EXPOSE_RESET_TOKEN', 'JWT_SECRET', 'CORS_ALLOWED_ORIGINS', 'SMTP_USER', 'SMTP_PASS']) delete base[key];
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    env: { ...base, ...vars },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: result.status, out: `${result.stdout || ''}`, err: `${result.stderr || ''}` };
}

const PROD = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-long-random-production-secret-for-the-test',
  CORS_ALLOWED_ORIGINS: 'https://shop.example',
  ADMIN_PASSWORD: 'a-long-production-admin-password',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/placeholder',
  SMTP_USER: '',
  SMTP_PASS: '',
};
const SHOW = "const { env } = await import('./server/config/env.js'); console.log(JSON.stringify({ nodeEnv: env.nodeEnv, prod: env.isProduction, expose: env.exposeResetToken }));";

console.log('\n--- NODE_ENV ---');
for (const bad of ['', 'Production', 'prod', 'staging']) {
  const r = run(SHOW, { ...PROD, NODE_ENV: bad });
  assert(r.code !== 0 && /\[FATAL\] NODE_ENV must be/.test(r.err), `NODE_ENV=${JSON.stringify(bad)}: the server config refuses to load`);
}
assert(/got nothing|got ""/.test(run(SHOW, { ...PROD, NODE_ENV: '' }).err), 'the error message says what was received');
for (const good of ['production', 'development', 'test']) {
  const r = run(SHOW, { ...PROD, NODE_ENV: good, JWT_SECRET: good === 'production' ? PROD.JWT_SECRET : '' });
  assert(r.code === 0 && lastJson(r.out).nodeEnv === good, `NODE_ENV=${good}: loads`);
}

console.log('\n--- Reset token exposure ---');
const prodFlag = lastJson(run(SHOW, { ...PROD, EXPOSE_RESET_TOKEN: 'true' }).out);
assert(prodFlag.prod === true && prodFlag.expose === false, 'production: never exposed, even with EXPOSE_RESET_TOKEN=true');
const devOn = lastJson(run(SHOW, { NODE_ENV: 'development', EXPOSE_RESET_TOKEN: 'true' }).out);
assert(devOn.expose === true, 'development with EXPOSE_RESET_TOKEN=true: exposed (as before)');
const devOff = lastJson(run(SHOW, { NODE_ENV: 'development', EXPOSE_RESET_TOKEN: '' }).out);
assert(devOff.expose === false, 'development without the flag: not exposed');
const devFalse = lastJson(run(SHOW, { NODE_ENV: 'development', EXPOSE_RESET_TOKEN: 'false' }).out);
assert(devFalse.expose === false, 'EXPOSE_RESET_TOKEN=false: not exposed');

console.log('\n--- E-mail without SMTP credentials ---');
const { resolveMailMode } = await import('../services/email.service.js');
assert(resolveMailMode({ smtpUser: 'u', smtpPass: 'p', isProduction: true }) === 'smtp', 'credentials set: real SMTP');
assert(resolveMailMode({ smtpUser: 'u', smtpPass: 'p', isProduction: false }) === 'smtp', 'credentials set in development: real SMTP');
assert(resolveMailMode({ smtpUser: '', smtpPass: '', isProduction: false }) === 'ethereal', 'development without credentials: Ethereal fake inbox (unchanged)');
assert(resolveMailMode({ smtpUser: '', smtpPass: '', isProduction: true }) === 'off', 'production without credentials: off');
assert(resolveMailMode({ smtpUser: 'u', smtpPass: '', isProduction: true }) === 'off', 'production with only a user: off');
const send = run(
  "const { sendEmail } = await import('./server/services/email.service.js'); try { await sendEmail({ to: 'client@example.com', subject: 's', html: '<p>x</p>' }); console.log('SENT'); } catch (e) { console.log('ERROR:' + e.message); }",
  PROD,
);
assert(/ERROR:L'envoi d'e-mails n'est pas configuré/.test(send.out) && !/SENT|Ethereal/.test(send.out), 'production without credentials: sending fails with a clear message, nothing leaves the server');

console.log('\n--- Process handlers ---');
const { installProcessSafetyHandlers } = await import('../utils/processSafety.js');
const fakeProc = new EventEmitter();
const logs = [];
let exitCode = null;
installProcessSafetyHandlers({ proc: fakeProc, log: { error: (...args) => logs.push(args.join(' ')) }, exit: (code) => { exitCode = code; } });
fakeProc.emit('unhandledRejection', new Error('boom'));
assert(logs.length === 1 && /Unhandled promise rejection/.test(logs[0]) && exitCode === null, 'an unhandled rejection is logged and the server keeps running');
fakeProc.emit('uncaughtException', new Error('crash'));
assert(logs.length === 2 && /Uncaught exception/.test(logs[1]) && exitCode === 1, 'an uncaught exception is logged and the process exits with code 1 (for the process manager)');

console.log('\n--- Database pool ---');
const { pool } = await import('../db/pool.js');
assert(pool.listenerCount('error') >= 1, 'the pool has an error listener (an idle connection error no longer stops Node)');
assert(pool.options.connectionTimeoutMillis === 30000, 'a request waits at most 30 s for a database connection');
await pool.end().catch(() => {});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
