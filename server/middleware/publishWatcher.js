import { env } from '../config/env.js';
import { scheduleCheck } from '../services/publish.service.js';

// Requests that can never change what the public pages show.
const IGNORED = /^\/(auth|cart|favourites|contact|notifications|publish)(\/|$)/;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * After a successful write that could have changed the public site (a product, a theme, a review, an order that sells the last
 * item ...), schedule one look at the catalogue (services/publish.service.js). Costs nothing when no hook is configured.
 */
export function publishWatcher(req, res, next) {
  if (env.publish.hookUrl && WRITES.has(req.method) && !IGNORED.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode < 400) scheduleCheck();
    });
  }
  next();
}
