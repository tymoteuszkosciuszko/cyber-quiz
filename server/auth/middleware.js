import { timingSafeEqualStr } from './crypto.js';
import {
  clearSessionCookie,
  getSession,
  getSessionCookieFromHeaders,
} from './sessions.js';

export function noStoreHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

export function isOriginAllowed(origin, allowedOrigins, reqHost = null) {
  if (!origin) return true;
  if (allowedOrigins === '*') return true;

  if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
    return true;
  }

  // Pozwól na same-origin (np. gdy aplikacja jest za proxy na tym samym hoście)
  if (reqHost) {
    try {
      const parsed = new URL(origin);
      if (parsed.host === reqHost) return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function createRequireAuth(
  redis,
  { allowMustChangePassword = false } = {}
) {
  return async function requireAuth(req, res, next) {
    try {
      const sid = getSessionCookieFromHeaders(req.headers);
      if (!sid) {
        return res.status(401).json({ error: 'UNAUTHENTICATED' });
      }

      const found = await getSession(redis, sid, { touch: true });
      if (!found) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'SESSION_EXPIRED' });
      }

      const { sidHash, session } = found;

      if (!session.mfaVerified) {
        return res.status(403).json({ error: 'MFA_REQUIRED' });
      }

      if (session.mustChangePassword && !allowMustChangePassword) {
        return res.status(403).json({ error: 'MUST_CHANGE_PASSWORD' });
      }

      req.sid = sid;
      req.sidHash = sidHash;
      req.session = session;
      req.user = {
        id: session.userId,
        username: session.username,
        role: session.role,
        mustChangePassword: Boolean(session.mustChangePassword),
      };

      return next();
    } catch (err) {
      console.error('[AUTH_MIDDLEWARE_ERROR]', err.message);
      return res.status(500).json({ error: 'AUTH_CHECK_FAILED' });
    }
  };
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  return next();
}

export function createRequireCsrf(allowedOrigins) {
  return function requireCsrf(req, res, next) {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const reqHost = req.get('host');
    const origin = req.headers.origin;
    if (origin && !isOriginAllowed(origin, allowedOrigins, reqHost)) {
      return res.status(403).json({ error: 'INVALID_ORIGIN' });
    }

    if (!origin && req.headers.referer) {
      try {
        const refOrigin = new URL(req.headers.referer).origin;
        if (!isOriginAllowed(refOrigin, allowedOrigins, reqHost)) {
          return res.status(403).json({ error: 'INVALID_ORIGIN' });
        }
      } catch {
        return res.status(403).json({ error: 'INVALID_ORIGIN' });
      }
    }

    const headerToken = req.headers['x-csrf-token'];
    const sessionToken = req.session?.csrfToken;
    if (
      typeof headerToken !== 'string' ||
      typeof sessionToken !== 'string' ||
      !timingSafeEqualStr(headerToken, sessionToken)
    ) {
      return res.status(403).json({ error: 'INVALID_CSRF_TOKEN' });
    }

    return next();
  };
}

export function createSocketAuthMiddleware(redis, allowedOrigins) {
  return async function socketAuthMiddleware(socket, next) {
    try {
      const origin = socket.handshake.headers?.origin;
      const host = socket.handshake.headers?.host;
      if (origin && !isOriginAllowed(origin, allowedOrigins, host)) {
        return next(new Error('INVALID_ORIGIN'));
      }

      const sid = getSessionCookieFromHeaders(socket.handshake.headers);
      if (sid) {
        const found = await getSession(redis, sid, { touch: true });
        if (
          found &&
          found.session.mfaVerified &&
          !found.session.mustChangePassword
        ) {
          socket.data.user = {
            id: found.session.userId,
            username: found.session.username,
            role: found.session.role,
          };
          socket.data.sidHash = found.sidHash;
        }
      }

      // Połączenia bez sesji są dozwolone dla publicznych graczy (/) oraz ekranu (/game-screen)
      return next();
    } catch (err) {
      console.error('[SOCKET_AUTH_ERROR]', err.message);
      return next();
    }
  };
}

