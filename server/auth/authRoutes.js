import express from 'express';
import { z } from 'zod';
import { extractReqMeta, logAudit } from './audit.js';
import {
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from './crypto.js';
import {
  createRequireAuth,
  createRequireCsrf,
  noStoreHeaders,
} from './middleware.js';
import {
  MAX_PASSWORD_LENGTH,
  normalizePassword,
  validatePassword,
} from './passwordPolicy.js';
import {
  checkLoginIpRateLimit,
  computeLockoutUntil,
  recordLoginIpFailure,
} from './rateLimit.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionCookieFromHeaders,
  revokeAllUserSessions,
  setSessionCookie,
} from './sessions.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export function createAuthRouter({ pool, redis, allowedOrigins }) {
  const router = express.Router();
  const requireAuthAny = createRequireAuth(redis, {
    allowMustChangePassword: true,
  });
  const requireCsrf = createRequireCsrf(allowedOrigins);

  router.use(noStoreHeaders);

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    const meta = extractReqMeta(req);

    try {
      const rl = await checkLoginIpRateLimit(redis, meta.ip);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        await logAudit(pool, {
          actorName: String(req.body?.username || '').slice(0, 64) || null,
          eventType: 'AUTH_LOGIN_RATE_LIMITED',
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'FAILURE',
        });
        return res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }

      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        await recordLoginIpFailure(redis, meta.ip);
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      }

      const usernameNormalized = parsed.data.username.toLowerCase();
      const normalizedPassword = normalizePassword(parsed.data.password);

      const { rows } = await pool.query(
        `SELECT id, username, role, password_hash, is_active,
                must_change_password, failed_login_attempts, locked_until
         FROM users
         WHERE username_normalized = $1`,
        [usernameNormalized]
      );
      const user = rows[0] || null;

      // Stały nakład Argon2id nawet gdy użytkownik nie istnieje (ochrona przed enumeracją)
      const hashToCheck = user
        ? user.password_hash
        : await getDummyPasswordHash();

      const now = Date.now();
      const isLocked =
        Boolean(user?.locked_until) &&
        new Date(user.locked_until).getTime() > now;

      const passwordMatches = await verifyPassword(
        hashToCheck,
        normalizedPassword
      );

      if (!user) {
        await recordLoginIpFailure(redis, meta.ip);
        await logAudit(pool, {
          actorName: parsed.data.username,
          eventType: 'AUTH_LOGIN_FAILURE',
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'FAILURE',
          metadata: { reason: 'unknown_user' },
        });
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      }

      if (isLocked) {
        await recordLoginIpFailure(redis, meta.ip);
        await logAudit(pool, {
          actorId: user.id,
          actorName: user.username,
          eventType: 'AUTH_LOGIN_LOCKED',
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'FAILURE',
          metadata: { lockedUntil: user.locked_until },
        });
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      }

      if (!user.is_active) {
        await recordLoginIpFailure(redis, meta.ip);
        await logAudit(pool, {
          actorId: user.id,
          actorName: user.username,
          eventType: 'AUTH_LOGIN_INACTIVE',
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'FAILURE',
        });
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      }

      if (!passwordMatches) {
        await recordLoginIpFailure(redis, meta.ip);
        const nextAttempts = (user.failed_login_attempts || 0) + 1;
        const lockedUntil = computeLockoutUntil(nextAttempts);

        await pool.query(
          `UPDATE users
           SET failed_login_attempts = $2,
               locked_until = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [user.id, nextAttempts, lockedUntil]
        );

        await logAudit(pool, {
          actorId: user.id,
          actorName: user.username,
          eventType: lockedUntil ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILURE',
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'FAILURE',
          metadata: {
            failedAttempts: nextAttempts,
            lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
          },
        });
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      }

      // Poprawne logowanie: zeruj licznik błędów + zregeneruj sesję (ASVS V3.2.1)
      await pool.query(
        `UPDATE users
         SET failed_login_attempts = 0,
             locked_until = NULL,
             last_login_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );

      const previousSid = getSessionCookieFromHeaders(req.headers);
      if (previousSid) {
        await destroySession(redis, previousSid);
      }

      const { sid, session, maxAgeSeconds } = await createSession(
        redis,
        user,
        meta
      );
      setSessionCookie(res, sid, maxAgeSeconds);

      await logAudit(pool, {
        actorId: user.id,
        actorName: user.username,
        eventType: 'AUTH_LOGIN_SUCCESS',
        ip: meta.ip,
        userAgent: meta.userAgent,
        status: 'SUCCESS',
        metadata: { role: user.role },
      });

      return res.json({
        status: user.must_change_password
          ? 'MUST_CHANGE_PASSWORD'
          : 'AUTHENTICATED',
        csrfToken: session.csrfToken,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          mustChangePassword: Boolean(user.must_change_password),
        },
      });
    } catch (err) {
      console.error('[LOGIN_ERROR]', err.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // GET /api/auth/me
  router.get('/me', requireAuthAny, (req, res) => {
    res.json({
      status: req.user.mustChangePassword
        ? 'MUST_CHANGE_PASSWORD'
        : 'AUTHENTICATED',
      csrfToken: req.session.csrfToken,
      user: req.user,
    });
  });

  // POST /api/auth/logout
  router.post('/logout', requireAuthAny, requireCsrf, async (req, res) => {
    const meta = extractReqMeta(req);
    try {
      await destroySession(redis, req.sid);
      clearSessionCookie(res);

      await logAudit(pool, {
        actorId: req.user.id,
        actorName: req.user.username,
        eventType: 'AUTH_LOGOUT',
        ip: meta.ip,
        userAgent: meta.userAgent,
        status: 'SUCCESS',
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('[LOGOUT_ERROR]', err.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // POST /api/auth/logout-all
  router.post('/logout-all', requireAuthAny, requireCsrf, async (req, res) => {
    const meta = extractReqMeta(req);
    try {
      const revoked = await revokeAllUserSessions(redis, req.user.id);
      clearSessionCookie(res);

      await logAudit(pool, {
        actorId: req.user.id,
        actorName: req.user.username,
        eventType: 'AUTH_LOGOUT_ALL',
        ip: meta.ip,
        userAgent: meta.userAgent,
        status: 'SUCCESS',
        metadata: { revokedSessions: revoked },
      });

      return res.json({ success: true, revokedSessions: revoked });
    } catch (err) {
      console.error('[LOGOUT_ALL_ERROR]', err.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // POST /api/auth/change-password
  router.post(
    '/change-password',
    requireAuthAny,
    requireCsrf,
    async (req, res) => {
      const meta = extractReqMeta(req);
      try {
        const parsed = changePasswordSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: 'INVALID_PAYLOAD',
            message: 'Podaj aktualne oraz nowe hasło.',
          });
        }

        const currentNormalized = normalizePassword(parsed.data.currentPassword);
        const validation = validatePassword(
          parsed.data.newPassword,
          req.user.username
        );
        if (!validation.valid) {
          return res.status(400).json({
            error: validation.code,
            message: validation.message,
          });
        }

        if (validation.normalized === currentNormalized) {
          return res.status(400).json({
            error: 'PASSWORD_MUST_DIFFER',
            message: 'Nowe hasło musi różnić się od aktualnego.',
          });
        }

        const { rows } = await pool.query(
          `SELECT id, username, role, password_hash, is_active
           FROM users WHERE id = $1`,
          [req.user.id]
        );
        const user = rows[0];
        if (!user || !user.is_active) {
          await destroySession(redis, req.sid);
          clearSessionCookie(res);
          return res.status(401).json({ error: 'UNAUTHENTICATED' });
        }

        const matches = await verifyPassword(
          user.password_hash,
          currentNormalized
        );
        if (!matches) {
          await logAudit(pool, {
            actorId: user.id,
            actorName: user.username,
            eventType: 'AUTH_PASSWORD_CHANGE_FAILURE',
            ip: meta.ip,
            userAgent: meta.userAgent,
            status: 'FAILURE',
            metadata: { reason: 'wrong_current_password' },
          });
          return res.status(400).json({
            error: 'CURRENT_PASSWORD_INVALID',
            message: 'Aktualne hasło jest nieprawidłowe.',
          });
        }

        const newHash = await hashPassword(validation.normalized);
        await pool.query(
          `UPDATE users
           SET password_hash = $2,
               must_change_password = FALSE,
               updated_at = NOW()
           WHERE id = $1`,
          [user.id, newHash]
        );

        // Unieważnij wszystkie stare sesje i wygeneruj nową sesję (ASVS V3.2.1 / V3.3)
        await revokeAllUserSessions(redis, user.id);
        const { sid, session, maxAgeSeconds } = await createSession(
          redis,
          { ...user, must_change_password: false },
          meta
        );
        setSessionCookie(res, sid, maxAgeSeconds);

        await logAudit(pool, {
          actorId: user.id,
          actorName: user.username,
          eventType: 'AUTH_PASSWORD_CHANGED',
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'SUCCESS',
        });

        return res.json({
          status: 'AUTHENTICATED',
          csrfToken: session.csrfToken,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            mustChangePassword: false,
          },
        });
      } catch (err) {
        console.error('[CHANGE_PASSWORD_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  return router;
}

