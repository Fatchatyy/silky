import { env } from '../config/env.js';

// Paths that would only add noise: the uptime/health probe and static files.
const QUIET_PREFIXES = ['/health', '/uploads/', '/assets/', '/pictures/'];

/**
 * One line per request once it is answered: method, path, status, duration. Nothing else: no query string (it can carry
 * tokens), no body, no IP address, no headers, so the log holds no customer data. On by default in production
 * (LOG_REQUESTS=false turns it off), off elsewhere unless LOG_REQUESTS=true.
 */
export function requestLogger(req, res, next) {
  if (!env.logRequests) return next();
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (QUIET_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix))) return;
    const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const line = `[http] ${req.method} ${path} ${res.statusCode} ${ms}ms`;
    if (res.statusCode >= 500) console.error(line);
    else console.log(line);
  });
  next();
}
