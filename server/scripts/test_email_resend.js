/**
 * Sending e-mail through Resend (HTTPS) instead of SMTP.
 *
 * Hermetic: a local fake "Resend" HTTP server answers; nothing reaches the real Resend, no e-mail is sent, no database is
 * used. SMTP is pointed at a closed port, so a test that passed through SMTP would fail.
 *
 * Usage: node server/scripts/test_email_resend.js
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const API_KEY = 're_test_key_0123456789';
const requests = [];
let nextAnswer = { status: 200, body: { id: 'resend-id-1' } };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.writeHead(nextAnswer.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(nextAnswer.body));
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const port = fake.address().port;

Object.assign(process.env, {
  NODE_ENV: 'test',
  RESEND_API_KEY: API_KEY,
  RESEND_API_URL: `http://127.0.0.1:${port}/`,
  EMAIL_FROM: 'Silky <no-reply@shop.example>',
  EMAIL_REPLY_TO: 'help@shop.example',
  // SMTP is set too, but closed: Resend must win
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1',
  SMTP_USER: 'probe',
  SMTP_PASS: 'probe',
});

const { env } = await import('../config/env.js');
const email = await import('../services/email.service.js');

try {
  console.log('--- Which mode is used ---');
  assert(email.resolveMailMode({ resendApiKey: 'k', smtpUser: 'u', smtpPass: 'p', isProduction: true }) === 'resend', 'a Resend key wins over SMTP credentials');
  assert(email.resolveMailMode({ resendApiKey: 'k', isProduction: true }) === 'resend', 'a Resend key alone is enough, in production too');
  assert(email.resolveMailMode({ smtpUser: 'u', smtpPass: 'p', isProduction: true }) === 'smtp', 'without a Resend key SMTP is unchanged');
  assert(email.resolveMailMode({ isProduction: false }) === 'ethereal', 'development without credentials: Ethereal (unchanged)');
  assert(email.resolveMailMode({ isProduction: true }) === 'off', 'production without credentials: off (unchanged)');
  assert(env.resendApiUrl === `http://127.0.0.1:${port}`, 'the API address is read from RESEND_API_URL without a trailing slash');

  console.log('\n--- A message goes through the fake Resend ---');
  const logs = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  let info;
  try {
    info = await email.sendEmail({ to: ' customer@example.com ', subject: 'Votre commande', html: '<p>Bonjour <img src="cid:silky-logo"></p>', text: 'Bonjour', replyTo: 'someone@example.com' });
  } finally {
    console.log = realLog;
    console.error = realError;
  }
  const req = requests[0];
  assert(req && req.method === 'POST' && req.url === '/emails', 'one POST to /emails');
  assert(req.headers.authorization === `Bearer ${API_KEY}`, 'the key is sent as a Bearer token');
  assert(String(req.headers['content-type']).startsWith('application/json'), 'the body is JSON');
  assert(req.body.from === 'Silky <no-reply@shop.example>', 'from is EMAIL_FROM');
  assert(Array.isArray(req.body.to) && req.body.to.length === 1 && req.body.to[0] === 'customer@example.com', 'to is a one-address list, trimmed');
  assert(req.body.subject === 'Votre commande' && req.body.html.includes('cid:silky-logo') && req.body.text === 'Bonjour', 'subject, html and text are sent');
  assert(req.body.reply_to === 'someone@example.com', 'the per-message reply-to is sent as reply_to');
  const logo = fs.readFileSync(path.resolve(__dirname, '../assets/logo.png'));
  const att = req.body.attachments?.[0];
  assert(att && att.filename === 'logo.png' && att.content_id === 'silky-logo' && att.content_type === 'image/png', 'the logo is attached inline with content_id silky-logo');
  assert(att && Buffer.from(att.content, 'base64').equals(logo), 'the logo bytes are sent as base64');
  assert(info.messageId === 'resend-id-1', 'the caller gets the provider id as messageId');
  assert(!logs.some((line) => line.includes(API_KEY)), 'the API key never reaches the logs');

  console.log('\n--- Default reply-to and the other mails ---');
  await email.sendEmail({ to: 'a@example.com', subject: 's', html: '<p>x</p>' });
  assert(requests[1].body.reply_to === 'help@shop.example', 'EMAIL_REPLY_TO is used when the message has none');
  await email.sendPasswordResetEmail('b@example.com', 'rawtoken123');
  assert(requests[2] && JSON.stringify(requests[2].body).includes('rawtoken123'), 'the password-reset mail goes through Resend with its link');

  console.log('\n--- Failures ---');
  nextAnswer = { status: 422, body: { name: 'validation_error', message: 'The from address is not verified' } };
  let error;
  try {
    await email.sendEmail({ to: 'c@example.com', subject: 's', html: '<p>x</p>' });
  } catch (err) {
    error = err;
  }
  assert(error && /HTTP 422/.test(error.message) && /not verified/.test(error.message), 'a refusal throws with the status and the provider message');
  assert(error && !error.message.includes(API_KEY), 'the error does not contain the API key');

  nextAnswer = { status: 500, body: 'not json' };
  error = null;
  try {
    await email.sendEmail({ to: 'c@example.com', subject: 's', html: '<p>x</p>' });
  } catch (err) {
    error = err;
  }
  assert(error && /HTTP 500/.test(error.message), 'a 500 with a body that is not JSON still throws cleanly');

  const down = email.createResendTransport({ apiKey: API_KEY, apiUrl: 'http://127.0.0.1:1' });
  error = null;
  try {
    await down.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 's', html: 'h' });
  } catch (err) {
    error = err;
  }
  assert(error && /injoignable/.test(error.message), 'an unreachable Resend throws a clear message');

  const slow = email.createResendTransport({
    apiKey: API_KEY,
    apiUrl: 'http://x',
    fetchImpl: async () => {
      const timeout = new Error('timed out');
      timeout.name = 'TimeoutError';
      throw timeout;
    },
  });
  error = null;
  try {
    await slow.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 's', html: 'h' });
  } catch (err) {
    error = err;
  }
  assert(error && /délai dépassé/.test(error.message), 'a timeout is reported as such');

  console.log('\n--- Wiring ---');
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
  assert(/RESEND_API_KEY/.test(read('../.env.example')), 'RESEND_API_KEY is documented in .env.example');
  assert(/resendApiKey/.test(read('../scripts/preflight.js')), 'the preflight understands a Resend key');
  assert(/!env\.resendApiKey/.test(read('../services/auth.service.js')), 'the reset token is never exposed once Resend delivers the mail');
} finally {
  await new Promise((resolve) => fake.close(resolve));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 300);
