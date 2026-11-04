import express from 'express';
import './utils/asyncErrors.js';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import fs from 'fs/promises';
import apiRoutes from './routes/index.js';
import webhookRoutes from './routes/webhooks.routes.js';
import { guestSessionMiddleware } from './middleware/guestSession.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { requestLogger } from './middleware/requestLogger.js';
import { pool } from './db/pool.js';
import { UPLOADS_DIR } from './utils/upload.js';
import { env } from './config/env.js';
import { createSeoRouter } from './seo/pageHandler.js';
import { databaseLoaders } from './seo/loaders.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const app = express();

app.disable('x-powered-by');
// Behind a reverse proxy (TRUST_PROXY set), req.ip is the visitor's address instead of the proxy's; unset locally.
if (env.trustProxy) app.set('trust proxy', env.trustProxy);
app.use(securityHeaders);
app.use(requestLogger);

// gzip for text responses (pages, scripts, styles, JSON) when the browser accepts it. Photos, videos and anything
// already compressed are skipped by the package; responses under 1 kB are sent as they are. A host that compresses
// in front of this server simply sees an already-encoded response and leaves it alone.
app.use(compression());

app.use(
  cors({
    origin: env.corsAllowedOrigins,
    credentials: true,
    // The browser hides response headers from another origin unless they are exposed; the apps read the guest id.
    exposedHeaders: ['X-Guest-Session-ID'],
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
// Photos uploaded with resized copies (see utils/imageVariants.js) have a unique, never reused name, so browsers may
// keep them for a year. Older uploads and videos keep the default caching.
const RESIZED_UPLOAD_FILE = /^\d+-[0-9a-f]{8}-r(\.(card|share|large))?\.(jpe?g|png|webp)$/i;
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    setHeaders(res, filePath) {
      // Uploads are files to display, never pages: if one is opened directly, nothing in it may run.
      res.setHeader('Content-Security-Policy', 'sandbox');
      if (RESIZED_UPLOAD_FILE.test(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);
app.use(express.static(PUBLIC_DIR));

// Liveness/readiness probe for the host and uptime monitors: 200 only when the database answers within 3 seconds.
// Outside /api on purpose (no guest cookie, no rate limit) and it reveals nothing but the word ok.
app.get('/health', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let timer;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('database timeout')), 3000); }),
    ]);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[health] database check failed:', err.message);
    res.status(503).json({ status: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
});

// Provider webhooks are public and authenticated by their own secret; mounted before
// the guest-session middleware so no guest cookie is issued for them.
app.use('/api/webhooks', webhookRoutes);
app.use('/api', guestSessionMiddleware, apiRoutes);

// Built storefront, robots.txt and sitemap.xml (see server/seo/pageHandler.js). Outside /api, so no guest cookie.
app.use(createSeoRouter({ ...env.seo, loaders: databaseLoaders }));

// Global middleware error handler (handles body parser errors like 413 Payload Too Large)
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Payload too large. Maximum allowed size is 100kb.' });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[server error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

export async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export { app, env };
