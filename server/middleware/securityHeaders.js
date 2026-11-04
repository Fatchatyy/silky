import { env } from '../config/env.js';

// What the pages load: own scripts and styles (React sets inline style attributes, hence 'unsafe-inline' for styles),
// Google Fonts (Playfair Display, Cairo), product photos (own uploads, and any https image an admin pastes), own videos.
// JSON-LD blocks are data, not scripts. No iframes, plugins or third-party scripts.
const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const CSP_HEADER = { 'report-only': 'Content-Security-Policy-Report-Only', enforce: 'Content-Security-Policy' };

// Baseline response headers. The page Content-Security-Policy ships in report-only mode first (CSP_MODE, see env.js):
// it cannot block anything, it only makes the browser console list what a strict policy would have refused.
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (env.isProduction) {
    // Browsers ignore this over plain HTTP, so it only takes effect once the site is served over HTTPS.
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  const cspHeader = CSP_HEADER[env.cspMode];
  // Pages only: API answers are JSON and /uploads files already carry their own "sandbox" policy.
  if (cspHeader && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
    res.setHeader(cspHeader, PAGE_POLICY);
  }
  next();
}
