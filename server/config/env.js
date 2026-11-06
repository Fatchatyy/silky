import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '../.env') });

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
function integerEnv(name, fallback, min, source = process.env) {
  const raw = source[name];
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
 * In development, defaults to the Astro dev server origins (storefront and admin, port 4321).
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

  const devOrigins = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);
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

/**
 * Where uploaded photos and videos are stored: STORAGE_DRIVER=disk (default, UPLOADS_DIR) or r2 (Cloudflare R2).
 * Choosing r2 without its credentials stops the server at start: uploads would fail on the first photo.
 */
export function parseStorageConfig(source = process.env) {
  const driver = String(source.STORAGE_DRIVER || 'disk').trim().toLowerCase();
  if (!['disk', 'r2'].includes(driver)) {
    throw new Error(`[FATAL] STORAGE_DRIVER must be "disk" or "r2" (got ${JSON.stringify(source.STORAGE_DRIVER)}).`);
  }
  const r2 = {
    accountId: String(source.R2_ACCOUNT_ID || '').trim(),
    accessKeyId: String(source.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(source.R2_SECRET_ACCESS_KEY || '').trim(),
    bucket: String(source.R2_BUCKET || '').trim(),
  };
  if (driver === 'r2') {
    const names = { accountId: 'R2_ACCOUNT_ID', accessKeyId: 'R2_ACCESS_KEY_ID', secretAccessKey: 'R2_SECRET_ACCESS_KEY', bucket: 'R2_BUCKET' };
    const missing = Object.entries(names).filter(([key]) => !r2[key]).map(([, name]) => name);
    if (missing.length) throw new Error(`[FATAL] STORAGE_DRIVER=r2 needs ${missing.join(', ')}.`);
  }
  return { driver, r2, mediaPublicUrl: String(source.MEDIA_PUBLIC_URL || '').trim().replace(/\/+$/, '') };
}

/**
 * The publish trigger (services/publish.service.js): PUBLISH_HOOK_URL is a URL the API POSTs to (empty body) when the
 * catalogue the public site shows has changed, to start a rebuild (a Cloudflare deploy hook, a GitHub workflow dispatch URL ...).
 * It is a SECRET (it usually carries a token): never logged, never sent to a client. Unset = no automatic publishing: the admin
 * still shows when the live site is behind and the owner runs `npm run publish-site`. In production it must be https.
 */
export function parsePublishConfig(source = process.env, isProd = isProduction) {
  const raw = String(source.PUBLISH_HOOK_URL || '').trim();
  if (raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('[FATAL] PUBLISH_HOOK_URL is not a valid URL.');
    }
    if (isProd && url.protocol !== 'https:') throw new Error('[FATAL] PUBLISH_HOOK_URL must be an https URL in production.');
  }
  return {
    hookUrl: raw,
    // After an admin change (or an order) wait this long before looking, so a burst of edits is looked at once.
    checkDelayMs: integerEnv('PUBLISH_CHECK_DELAY_SECONDS', 30, 0, source) * 1000,
    hookTimeoutMs: integerEnv('PUBLISH_HOOK_TIMEOUT_MS', 10000, 1000, source),
  };
}

export function parseCspMode(raw = process.env.CSP_MODE) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ['off', 'report-only', 'enforce'].includes(value) ? value : 'report-only';
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
  publish: parsePublishConfig(),

  // Email / SMTP
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  // Resend (HTTPS API): used instead of SMTP when RESEND_API_KEY is set. Render's free plan blocks the SMTP ports.
  resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
  resendApiUrl: (process.env.RESEND_API_URL || 'https://api.resend.com').trim().replace(/\/+$/, ''),
  emailFrom: process.env.EMAIL_FROM || (process.env.SMTP_USER ? `Silky <${process.env.SMTP_USER}>` : 'Silky <no-reply@silky.tn>'),
  emailReplyTo: process.env.EMAIL_REPLY_TO || undefined,
  appUrl: process.env.APP_URL || 'http://localhost:4321',

  // Where uploaded photos and videos are stored and served from (/uploads). Default: server/uploads.
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../uploads')),

  // Storage driver of uploads: 'disk' (UPLOADS_DIR) or 'r2' (Cloudflare R2). See services/storage.service.js.
  storage: parseStorageConfig(),

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
