/**
 * Single-Process In-Memory Sliding-Window Rate Limiter Middleware
 *
 * NOTE: This rate limiter is process-local and suitable for the single Node.js
 * instance deployment architecture. Before horizontal/multi-process deployment,
 * this store should be migrated to a shared store (such as Redis).
 */

class SlidingWindowStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.hits = new Map(); // key -> Array of timestamps
  }

  increment(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.hits.get(key) || [];
    // Prune timestamps outside current window
    timestamps = timestamps.filter((t) => t > windowStart);

    timestamps.push(now);
    this.hits.set(key, timestamps);

    const currentCount = timestamps.length;
    const oldestTimestamp = timestamps[0];
    const resetTimeMs = Math.max(0, oldestTimestamp + this.windowMs - now);

    return {
      count: currentCount,
      resetTimeMs,
    };
  }

  reset() {
    this.hits.clear();
  }
}

const allStores = [];

/**
 * Creates an Express rate-limiting middleware instance.
 */
export function createRateLimiter({
  windowMs = 60 * 1000,
  max = 10,
  message = 'Trop de requêtes. Veuillez réessayer plus tard.',
  keyGenerator = (req) => req.ip || req.socket?.remoteAddress || '127.0.0.1',
}) {
  const store = new SlidingWindowStore(windowMs);
  allStores.push(store);

  const limiter = (req, res, next) => {
    try {
      const key = keyGenerator(req);
      const { count, resetTimeMs } = store.increment(key);

      const retryAfterSeconds = Math.ceil(resetTimeMs / 1000);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ error: message });
      }

      next();
    } catch (err) {
      console.error('[rateLimiter] Error during rate limit evaluation:', err.message);
      // Fail open to avoid blocking legitimate requests on unexpected rate limiter error
      next();
    }
  };

  limiter.reset = () => store.reset();
  return limiter;
}

/**
 * Strictly for test suites — resets all in-memory rate limit stores.
 */
export function _resetRateLimits() {
  for (const store of allStores) {
    store.reset();
  }
}

// 1. Admin login limiter: strictly 5 attempts per 15 minutes per IP
export const adminLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de connexion administrateur. Veuillez réessayer dans 15 minutes.',
  keyGenerator: (req) => `admin_login:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});

// 2. Customer checkout limiter: 10 requests per minute per IP + shopper
export const checkoutLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Trop de commandes en peu de temps. Veuillez patienter un instant.',
  keyGenerator: (req) => {
    const shopperId = req.user?.id || req.guestSessionId || 'guest';
    const ip = req.ip || req.socket?.remoteAddress || 'ip';
    return `checkout:${ip}:${shopperId}`;
  },
});

// 3. Public order creation limiter: 10 requests per minute per IP + shopper
export const orderCreationLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Trop de commandes en peu de temps. Veuillez patienter un instant.',
  keyGenerator: (req) => {
    const shopperId = req.user?.id || req.guestSessionId || 'guest';
    const ip = req.ip || req.socket?.remoteAddress || 'ip';
    return `order_create:${ip}:${shopperId}`;
  },
});

// 4. Admin order mutation limiter: 30 operations per minute per admin user + IP
export const orderMutationLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Trop de requêtes administratives. Veuillez patienter un instant.',
  keyGenerator: (req) => {
    const adminId = req.user?.id || 'admin';
    const ip = req.ip || req.socket?.remoteAddress || 'ip';
    return `order_mutation:${ip}:${adminId}`;
  },
});

// 5. Customer login limiter: 10 attempts per 15 minutes per IP
export const authLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.',
  keyGenerator: (req) => `auth_login:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});
export const customerLoginLimiter = authLoginLimiter;

// 6. Customer registration limiter: 5 attempts per 15 minutes per IP
export const authRegisterLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de création de compte. Veuillez réessayer plus tard.',
  keyGenerator: (req) => `auth_register:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});
export const customerRegisterLimiter = authRegisterLimiter;

// 7. Customer forgot-password limiter: 5 requests per 15 minutes per IP
export const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de demandes de réinitialisation de mot de passe. Veuillez réessayer dans 15 minutes.',
  keyGenerator: (req) => `auth_forgot_password:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});

// 8. Customer reset-password limiter: 5 attempts per 15 minutes per IP
export const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de réinitialisation de mot de passe. Veuillez réessayer dans 15 minutes.',
  keyGenerator: (req) => `auth_reset_password:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});

// 9. Public provider webhook limiter: generous 600 requests per minute per IP, so a
// burst of status changes from the carrier is not rejected (a 429 may never be retried)
export const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
  message: 'Trop de requêtes.',
  keyGenerator: (req) => `webhook:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});

// 10. Public contact form: 10 messages per 15 minutes per IP (each one raises an admin notification)
export const contactLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Trop de messages envoyés. Veuillez réessayer plus tard.',
  keyGenerator: (req) => `contact:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});

// 11. Review submission (store and product): 10 per 15 minutes per account + IP
export const reviewLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Trop d\'avis envoyés. Veuillez réessayer plus tard.',
  keyGenerator: (req) => `review:${req.ip || req.socket?.remoteAddress || 'ip'}:${req.user?.id || 'guest'}`,
});

// 12. Adding to the cart: 300 per minute per IP. Deliberately generous (several shoppers can share one IP);
// it only stops a script from creating guest carts in bulk by sending a new guest session with every request.
export const cartAddLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Trop de requêtes. Veuillez patienter un instant.',
  keyGenerator: (req) => `cart_add:${req.ip || req.socket?.remoteAddress || 'ip'}`,
});
