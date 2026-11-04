import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSiteUrl } from '../seo/siteUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '../../.env') });

// NODE_ENV decides secure cookies, the JWT secret check, CORS defaults and serving the built shop. A host that forgets
// it (or mistypes "Production") must not silently run with development settings, so anything else stops the server.
const rawNodeEnv = process.env.NODE_ENV;
if (!['production', 'development', 'test'].includes(rawNodeEnv)) {
  throw new Error(
    `[FATAL] NODE_ENV must be "production", "development" or "test" (got ${rawNodeEnv === undefined ? 'nothing' : JSON.stringify(rawNodeEnv)}). Without it the server would run with development settings.`,
  );
}
const isProduction = rawNodeEnv === 'production';

/** Integer environment variable with a floor; unset, blank or invalid values fall back to the default. */
function integerEnv(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

const KNOWN_DEV_JWT_SECRETS = new Set([
  'silky-dev-jwt-secret-change-me',
  'silky-dev-jwt-secret-change-me-in-production',
  'change-me-to-a-long-random-secret',
  'secret',
  'jwtsecret',
]);

/**
 * Validates the JWT secret for production safety.
 * In development, allows fallback default secret.
 * In production, strictly requires a non-default, strong secret (min 16 chars).
 */
export function validateJwtSecret(rawSecret, isProd = isProduction) {
  const secret = (rawSecret !== undefined ? rawSecret : process.env.JWT_SECRET)?.trim();
  if (isProd) {
    if (!secret) {
      throw new Error('[FATAL] JWT_SECRET must be set in production.');
    }
    if (KNOWN_DEV_JWT_SECRETS.has(secret) || secret.length < 16) {
      throw new Error(
        '[FATAL] JWT_SECRET is using an insecure or default development value in production. Please configure a strong, random production secret.'
      );
    }
    return secret;
  }
  return secret || 'silky-dev-jwt-secret-change-me';
}

/**
 * Parses and validates CORS allowed origins.
 * Trims whitespace, ignores empty entries, compares origins exactly.
 * In production, fails fast if CORS_ALLOWED_ORIGINS is missing or empty.
 * In development, defaults to Vite development server origins.
 */
export function parseCorsOrigins(
  rawEnv,
  isProd = isProduction,
  appUrl = process.env.APP_URL
) {
  const envVal = rawEnv !== undefined ? rawEnv : process.env.CORS_ALLOWED_ORIGINS;
  if (envVal && typeof envVal === 'string') {
    const origins = envVal
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (origins.length > 0) {
      return origins;
    }
  }

  if (isProd) {
    throw new Error(
      '[FATAL] CORS_ALLOWED_ORIGINS must be set and non-empty in production. Set a comma-separated list of allowed origins (e.g. CORS_ALLOWED_ORIGINS="https://yourdomain.com").'
    );
  }

  const devOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  if (appUrl) {
    try {
      const parsed = new URL(appUrl);
      devOrigins.add(parsed.origin);
    } catch {
      devOrigins.add(appUrl.trim());
    }
  }
  return Array.from(devOrigins).filter(Boolean);
}

const KNOWN_DEV_ADMIN_PASSWORDS = new Set(['silky-admin', 'change-me', 'admin', 'password']);

/**
 * Admin panel password. Development keeps the convenient fallback; production refuses to start without a real one
 * (set, not a known placeholder, at least 10 characters), like it does for JWT_SECRET.
 */
export function validateAdminPassword(rawPassword, isProd = isProduction) {
  const password = rawPassword !== undefined ? rawPassword : process.env.ADMIN_PASSWORD;
  if (isProd) {
    if (!password) {
      throw new Error('[FATAL] ADMIN_PASSWORD must be set in production.');
    }
    if (KNOWN_DEV_ADMIN_PASSWORDS.has(password) || password.length < 10) {
      throw new Error('[FATAL] ADMIN_PASSWORD is a default or too short (minimum 10 characters) for production. Set a strong, unique password.');
    }
    return password;
  }
  return password || 'silky-admin';
}

/** In production the database must be named explicitly: never fall back to a local default. */
export function validateDatabaseUrl(rawUrl, isProd = isProduction) {
  const url = rawUrl !== undefined ? rawUrl : process.env.DATABASE_URL;
  if (isProd && !url) {
    throw new Error('[FATAL] DATABASE_URL must be set in production.');
  }
  return url || 'postgres://postgres:postgres@localhost:5432/silky';
}

/**
 * TRUST_PROXY tells Express how many reverse proxies sit in front of it (for example 1 behind a single host proxy),
 * so req.ip, and with it the rate limiters, sees the visitor and not the proxy. Unset = no proxy, which is right
 * locally. Accepts a hop count or an Express trust value such as "loopback". Returns false when unset.
 */
export function parseTrustProxy(raw = process.env.TRUST_PROXY) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.toLowerCase() === 'false' || value === '0') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value.toLowerCase() === 'true') return 1; // never "trust everything": a client could then fake its address
  return value;
}

export function parseCspMode(raw = process.env.CSP_MODE) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ['off', 'report-only', 'enforce'].includes(value) ? value : 'report-only';
}

/** A bad SITE_URL must never stop the shop from starting: it is logged and treated as unset (SEO URLs off). */
function siteUrlFromEnv() {
  const siteUrl = parseSiteUrl(process.env.SITE_URL);
  if (siteUrl !== null) return siteUrl;
  console.error('[seo] SITE_URL is invalid (expected an origin such as https://example.tn, no path or trailing slash); ignoring it.');
  return '';
}

export const env = {
  nodeEnv: rawNodeEnv,
  port: Number(process.env.PORT) || 3001,
  databaseUrl: validateDatabaseUrl(),
  jwtSecret: validateJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@silky.tn',
  adminPassword: validateAdminPassword(),
  trustProxy: parseTrustProxy(),
  // Database pool. Defaults are what the app always used (pg's 10 connections, 30 s wait); change them to fit the
  // database plan's connection limit. DB_STATEMENT_TIMEOUT_MS=0 means no limit on how long one query may run.
  dbPoolMax: integerEnv('DB_POOL_MAX', 10, 1),
  dbConnectionTimeoutMs: integerEnv('DB_CONNECTION_TIMEOUT_MS', 30000, 1000),
  dbStatementTimeoutMs: integerEnv('DB_STATEMENT_TIMEOUT_MS', 0, 0),
  // One log line per request (see middleware/requestLogger.js): on in production unless LOG_REQUESTS=false.
  logRequests: process.env.LOG_REQUESTS === 'true' || (isProduction && process.env.LOG_REQUESTS !== 'false'),
  // Content-Security-Policy for the pages: 'report-only' (default; the browser only logs what it would block),
  // 'enforce' (blocks) or 'off'. Switch to 'enforce' only after the storefront and admin were browsed with no report.
  cspMode: parseCspMode(),
  guestSessionCookieName: process.env.GUEST_SESSION_COOKIE_NAME || 'silky_guest_session',
  passwordResetExpiresHours: Number(process.env.PASSWORD_RESET_EXPIRES_HOURS) || 1,
  isProduction,
  // Development only: the "forgot password" answer carries the reset token (shown by the page) when this is on.
  // Never in production, whatever the variable says.
  exposeResetToken: !isProduction && process.env.EXPOSE_RESET_TOKEN === 'true',
  corsAllowedOrigins: parseCorsOrigins(),

  // Email / SMTP
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailFrom: process.env.EMAIL_FROM || (process.env.SMTP_USER ? `Silky <${process.env.SMTP_USER}>` : 'Silky <no-reply@silky.tn>'),
  emailReplyTo: process.env.EMAIL_REPLY_TO || undefined,
  appUrl: process.env.APP_URL || 'http://localhost:5173',

  // Where uploaded photos and videos are stored and served from (/uploads). Default: server/uploads.
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../uploads')),

  // Server-written page head (see server/seo). Off unless SEO_HTML=on; the built frontend is served only in
  // production, with SEO_HTML=on, or when FRONTEND_DIST_DIR is set explicitly.
  seo: {
    siteUrl: siteUrlFromEnv(),
    htmlEnabled: String(process.env.SEO_HTML || '').trim().toLowerCase() === 'on',
    distDir: path.resolve(process.env.FRONTEND_DIST_DIR || path.join(__dirname, '../../dist')),
    serveFrontend:
      isProduction ||
      String(process.env.SEO_HTML || '').trim().toLowerCase() === 'on' ||
      Boolean(process.env.FRONTEND_DIST_DIR),
  },

  // GOODEX delivery. The API token and the webhook secret are distinct credentials.
  goodex: {

    baseUrl: (process.env.GOODEX_BASE_URL || 'https://transport.goodex.tn').replace(/\/+$/, ''),
    apiToken: process.env.GOODEX_API_TOKEN || '',
    userId: process.env.GOODEX_USER_ID || '',
    webhookSecret: process.env.GOODEX_WEBHOOK_SECRET || '',
    timeoutMs: Number(process.env.GOODEX_TIMEOUT_MS) || 10000,
    // Real GOODEX calls are off unless explicitly enabled (see liveCallBlockReason).
    enableLive: process.env.GOODEX_ENABLE_LIVE === 'true',
    // Background status reconciliation (read-only tracking of existing parcels).
    poll: {
      intervalMinutes: integerEnv('GOODEX_POLL_INTERVAL_MINUTES', 0, 0), // off unless set; a value like 15 enables it
      batchSize: integerEnv('GOODEX_POLL_BATCH_SIZE', 50, 1),
      concurrency: integerEnv('GOODEX_POLL_CONCURRENCY', 2, 1),
      maxAgeDays: integerEnv('GOODEX_POLL_MAX_AGE_DAYS', 60, 1),
    },
  },
};
