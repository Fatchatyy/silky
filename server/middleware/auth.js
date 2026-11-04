import { verifyAccessToken } from '../services/token.service.js';
import { userRepository } from '../repositories/user.repository.js';

/**
 * Checks a signed token against the account it names: the account must still exist, its token must not have been
 * revoked (logout, password change), and the role is the one stored now, not the one the token was signed with.
 * Returns the user to attach to the request, or null.
 */
async function resolveUser(token) {
  const payload = verifyAccessToken(token);
  const state = await userRepository.findAuthState(payload.sub);
  if (!state) return null;
  if (state.tokensValidAfter && !(payload.iat >= Math.floor(state.tokensValidAfter.getTime() / 1000))) return null;
  return {
    id: payload.sub,
    email: payload.email,
    role: state.role,
    fullName: payload.fullName,
  };
}

export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Veuillez vous connecter pour continuer.' });
  }

  let user = null;
  try {
    user = await resolveUser(token);
  } catch (err) {
    // A bad signature or an expired token is a plain 401; a database failure must not look like one.
    if (err?.name !== 'JsonWebTokenError' && err?.name !== 'TokenExpiredError' && err?.name !== 'NotBeforeError') {
      return next(err);
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
  }
  req.user = user;
  next();
}

/** Attaches req.user when a valid JWT is present; continues as guest otherwise. */
export async function optionalAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token) {
    return next();
  }

  try {
    const user = await resolveUser(token);
    if (user) req.user = user;
  } catch (err) {
    /* ignore an invalid token for optional auth, but not a database failure */
    if (err?.name !== 'JsonWebTokenError' && err?.name !== 'TokenExpiredError' && err?.name !== 'NotBeforeError') {
      return next(err);
    }
  }

  next();
}
