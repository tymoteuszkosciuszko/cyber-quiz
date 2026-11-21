import express from 'express';
import { z } from 'zod';
import { extractReqMeta, listAuditLogs, logAudit } from './audit.js';
import { generateTempPassword, hashPassword } from './crypto.js';
import {
  createRequireAuth,
  createRequireCsrf,
  noStoreHeaders,
  requireSuperAdmin,
} from './middleware.js';
import { validateUsername } from './passwordPolicy.js';
import { revokeAllUserSessions } from './sessions.js';

const uuidSchema = z.string().uuid();
const statusSchema = z.object({
  isActive: z.boolean(),
});

export function createAdminRouter({ pool, redis, allowedOrigins }) {
  const router = express.Router();
  const requireAuth = createRequireAuth(redis);
  const requireCsrf = createRequireCsrf(allowedOrigins);

  router.use(noStoreHeaders);
  router.use(requireAuth, requireSuperAdmin);

  // GET /api/admin/users
  router.get('/users', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.role, u.is_active, u.must_change_password,
                u.failed_login_attempts, u.locked_until, u.created_at, u.last_login_at,
                COUNT(q.id)::int AS quizzes_count
         FROM users u
         LEFT JOIN quizzes q ON q.owner_id = u.id
         GROUP BY u.id
         ORDER BY (u.role = 'superadmin') DESC, u.created_at ASC`
      );

      res.json(
        rows.map((r) => ({
          id: r.id,
          username: r.username,
          role: r.role,
          isActive: Boolean(r.is_active),
          mustChangePassword: Boolean(r.must_change_password),
          failedLoginAttempts: r.failed_login_attempts || 0,
          lockedUntil: r.locked_until,
          createdAt: r.created_at,
          lastLoginAt: r.last_login_at,
          quizzesCount: r.quizzes_count || 0,
        }))
      );
    } catch (err) {
      console.error('[ADMIN_LIST_USERS_ERROR]', err.message);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // POST /api/admin/users — zawsze tworzy wyłącznie rolę 'admin'
  router.post('/users', requireCsrf, async (req, res) => {
    const meta = extractReqMeta(req);
    try {
      // Jawna blokada próby przekazania roli superadmin
      if (req.body?.role && req.body.role !== 'admin') {
        await logAudit(pool, {
          actorId: req.user.id,
          actorName: req.user.username,
          eventType: 'ADMIN_CREATE_BLOCKED_ROLE',
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'FAILURE',
          metadata: { requestedRole: String(req.body.role) },
        });
        return res.status(403).json({
          error: 'SUPERADMIN_ROLE_FORBIDDEN',
          message: 'Można tworzyć wyłącznie konta zwykłych administratorów.',
        });
      }

      const usernameCheck = validateUsername(req.body?.username);
      if (!usernameCheck.valid) {
        return res.status(400).json({
          error: usernameCheck.code,
          message: usernameCheck.message,
        });
      }

      const temporaryPassword = generateTempPassword(16);
      const passwordHash = await hashPassword(temporaryPassword);

      const { rows } = await pool.query(
        `INSERT INTO users
           (username, username_normalized, role, password_hash, is_active, must_change_password, created_by)
         VALUES ($1, $2, 'admin', $3, TRUE, TRUE, $4)
         RETURNING id, username, role, is_active, must_change_password, created_at`,
        [
          usernameCheck.username,
          usernameCheck.normalized,
          passwordHash,
          req.user.id,
        ]
      );

      const created = rows[0];
      await logAudit(pool, {
        actorId: req.user.id,
        actorName: req.user.username,
        eventType: 'ADMIN_CREATED',
        targetId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        status: 'SUCCESS',
        metadata: { targetUsername: created.username },
      });

      return res.status(201).json({
        user: {
          id: created.id,
          username: created.username,
          role: created.role,
          isActive: Boolean(created.is_active),
          mustChangePassword: Boolean(created.must_change_password),
          createdAt: created.created_at,
          lastLoginAt: null,
          quizzesCount: 0,
        },
        temporaryPassword,
      });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({
          error: 'USERNAME_TAKEN',
          message: 'Konto o takiej nazwie użytkownika już istnieje.',
        });
      }
      console.error('[ADMIN_CREATE_USER_ERROR]', err.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // PATCH /api/admin/users/:id/status — aktywacja / dezaktywacja admina
  router.patch('/users/:id/status', requireCsrf, async (req, res) => {
    const meta = extractReqMeta(req);
    try {
      if (!uuidSchema.safeParse(req.params.id).success) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
      }
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'INVALID_PAYLOAD' });
      }

      const { rows } = await pool.query(
        `SELECT id, username, role, is_active FROM users WHERE id = $1`,
        [req.params.id]
      );
      const target = rows[0];
      if (!target) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
      }
      if (target.role === 'superadmin' || target.id === req.user.id) {
        return res.status(403).json({
          error: 'SUPERADMIN_PROTECTED',
          message: 'Nie można dezaktywować konta superadmina.',
        });
      }

      await pool.query(
        `UPDATE users
         SET is_active = $2,
             failed_login_attempts = CASE WHEN $2 THEN 0 ELSE failed_login_attempts END,
             locked_until = CASE WHEN $2 THEN NULL ELSE locked_until END,
             updated_at = NOW()
         WHERE id = $1`,
        [target.id, parsed.data.isActive]
      );

      let revoked = 0;
      if (!parsed.data.isActive) {
        revoked = await revokeAllUserSessions(redis, target.id);
      }

      await logAudit(pool, {
        actorId: req.user.id,
        actorName: req.user.username,
        eventType: parsed.data.isActive
          ? 'ADMIN_ACTIVATED'
          : 'ADMIN_DEACTIVATED',
        targetId: target.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        status: 'SUCCESS',
        metadata: {
          targetUsername: target.username,
          revokedSessions: revoked,
        },
      });

      return res.json({
        id: target.id,
        isActive: parsed.data.isActive,
        revokedSessions: revoked,
      });
    } catch (err) {
      console.error('[ADMIN_STATUS_ERROR]', err.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // POST /api/admin/users/:id/reset-password
  router.post('/users/:id/reset-password', requireCsrf, async (req, res) => {
    const meta = extractReqMeta(req);
    try {
      if (!uuidSchema.safeParse(req.params.id).success) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
      }

      const { rows } = await pool.query(
        `SELECT id, username, role FROM users WHERE id = $1`,
        [req.params.id]
      );
      const target = rows[0];
      if (!target) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
      }
      if (target.role === 'superadmin') {
        return res.status(403).json({
          error: 'SUPERADMIN_PROTECTED',
          message:
            'Reset hasła superadmina jest możliwy wyłącznie przez CLI serwera.',
        });
      }

      const temporaryPassword = generateTempPassword(16);
      const passwordHash = await hashPassword(temporaryPassword);

      await pool.query(
        `UPDATE users
         SET password_hash = $2,
             must_change_password = TRUE,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [target.id, passwordHash]
      );

      const revoked = await revokeAllUserSessions(redis, target.id);

      await logAudit(pool, {
        actorId: req.user.id,
        actorName: req.user.username,
        eventType: 'ADMIN_PASSWORD_RESET',
        targetId: target.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        status: 'SUCCESS',
        metadata: {
          targetUsername: target.username,
          revokedSessions: revoked,
        },
      });

      return res.json({
        id: target.id,
        username: target.username,
        temporaryPassword,
        revokedSessions: revoked,
      });
    } catch (err) {
      console.error('[ADMIN_RESET_PASSWORD_ERROR]', err.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // DELETE /api/admin/users/:id
  router.delete('/users/:id', requireCsrf, async (req, res) => {
    const meta = extractReqMeta(req);
    try {
      if (!uuidSchema.safeParse(req.params.id).success) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
      }

      const { rows } = await pool.query(
        `SELECT id, username, role FROM users WHERE id = $1`,
        [req.params.id]
      );
      const target = rows[0];
      if (!target) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
      }
      if (target.role === 'superadmin' || target.id === req.user.id) {
        return res.status(403).json({
          error: 'SUPERADMIN_PROTECTED',
          message: 'Nie można usunąć konta superadmina.',
        });
      }

      const revoked = await revokeAllUserSessions(redis, target.id);
      await pool.query(`DELETE FROM users WHERE id = $1`, [target.id]);

      await logAudit(pool, {
        actorId: req.user.id,
        actorName: req.user.username,
        eventType: 'ADMIN_DELETED',
        targetId: target.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        status: 'SUCCESS',
        metadata: {
          targetUsername: target.username,
          revokedSessions: revoked,
        },
      });

      return res.json({ deleted: true, revokedSessions: revoked });
    } catch (err) {
      console.error('[ADMIN_DELETE_USER_ERROR]', err.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // GET /api/admin/audit-logs
  router.get('/audit-logs', async (req, res) => {
    try {
      const result = await listAuditLogs(pool, {
        limit: req.query.limit,
        offset: req.query.offset,
        eventType: typeof req.query.eventType === 'string' ? req.query.eventType : '',
        status: typeof req.query.status === 'string' ? req.query.status : '',
        actor: typeof req.query.actor === 'string' ? req.query.actor : '',
      });
      res.json(result);
    } catch (err) {
      console.error('[ADMIN_AUDIT_LOGS_ERROR]', err.message);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}

