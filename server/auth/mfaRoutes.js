import express from 'express';
import { z } from 'zod';
import { extractReqMeta, logAudit } from './audit.js';
import { verifyPassword } from './crypto.js';
import {
  createRequireAuth,
  createRequireCsrf,
  noStoreHeaders,
  requireSuperAdmin,
} from './middleware.js';
import { MAX_PASSWORD_LENGTH, normalizePassword } from './passwordPolicy.js';
import {
  checkLoginIpRateLimit,
  computeLockoutUntil,
  recordLoginIpFailure,
} from './rateLimit.js';
import {
  clearSessionCookie,
  recordSessionMfaFailure,
  regenerateSession,
  revokeAllUserSessions,
  setSessionCookie,
} from './sessions.js';
import {
  MAX_MFA_VERIFY_ATTEMPTS,
  MAX_WEBAUTHN_CREDENTIALS,
  buildAuthenticationOptions,
  buildRegistrationOptions,
  consumeWebAuthnChallenge,
  countUserWebAuthnCredentials,
  deleteWebAuthnCredential,
  getUserWebAuthnCredentialByCredentialId,
  insertWebAuthnCredential,
  listUserWebAuthnCredentials,
  renameWebAuthnCredential,
  resolveExpectedOrigins,
  saveWebAuthnChallenge,
  serializeCredentialForClient,
  updateWebAuthnCredentialUsage,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn.js';

const uuidSchema = z.string().uuid();
const keyNameSchema = z
  .string()
  .trim()
  .min(1, 'Podaj nazwę klucza (1–64 znaki).')
  .max(64, 'Nazwa klucza może mieć maksymalnie 64 znaki.');

const registerOptionsSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH).optional(),
});

const registerVerifySchema = z.object({
  name: keyNameSchema,
  response: z.record(z.any()),
});

const loginVerifySchema = z.object({
  response: z.record(z.any()),
});

const renameSchema = z.object({
  name: keyNameSchema,
});

const deleteSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

async function verifyUserCurrentPassword(pool, userId, rawPassword) {
  if (!rawPassword || typeof rawPassword !== 'string') return false;
  const { rows } = await pool.query(
    `SELECT password_hash, is_active FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) return false;
  return verifyPassword(user.password_hash, normalizePassword(rawPassword));
}

export function createMfaRouter({
  pool,
  redis,
  allowedOrigins,
  webauthnConfig,
}) {
  const router = express.Router();
  const requireCsrf = createRequireCsrf(allowedOrigins);

  const requireMfaVerifyStage = createRequireAuth(redis, {
    allowMustChangePassword: true,
    allowMfaPending: true,
    allowedMfaStages: ['VERIFY'],
  });

  const requireMfaRegisterAllowed = createRequireAuth(redis, {
    allowMustChangePassword: false,
    allowMfaPending: true,
    allowedMfaStages: ['ENROLL'],
  });

  const requireFullSuperAdmin = createRequireAuth(redis, {
    allowMustChangePassword: false,
    allowMfaPending: false,
  });

  router.use(noStoreHeaders);

  // ==========================================================
  // KROK 2 LOGOWANIA (WERYFIKACJA KLUCZA)
  // ==========================================================

  // POST /api/auth/mfa/login/options
  router.post(
    '/login/options',
    requireMfaVerifyStage,
    requireSuperAdmin,
    requireCsrf,
    async (req, res) => {
      try {
        if (req.user.mfaVerified) {
          return res.status(400).json({ error: 'ALREADY_MFA_VERIFIED' });
        }

        const creds = await listUserWebAuthnCredentials(pool, req.user.id);
        if (creds.length === 0) {
          return res.status(409).json({
            error: 'NO_MFA_CREDENTIALS',
            message: 'Brak zarejestrowanych kluczy bezpieczeństwa.',
          });
        }

        const options = await buildAuthenticationOptions({
          existingCredentials: creds,
          config: webauthnConfig,
        });

        await saveWebAuthnChallenge(redis, 'auth', req.sidHash, options.challenge);
        return res.json({ options });
      } catch (err) {
        console.error('[MFA_LOGIN_OPTIONS_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  // POST /api/auth/mfa/login/verify
  router.post(
    '/login/verify',
    requireMfaVerifyStage,
    requireSuperAdmin,
    requireCsrf,
    async (req, res) => {
      const meta = extractReqMeta(req);

      const handleMfaFailure = async ({
        reason,
        eventType = 'AUTH_MFA_LOGIN_FAILURE',
        extraMeta = {},
        httpStatus = 401,
        errorCode = 'MFA_VERIFICATION_FAILED',
        message = 'Weryfikacja klucza bezpieczeństwa nie powiodła się.',
      }) => {
        await recordLoginIpFailure(redis, meta.ip);

        // Podbij licznik błędów na koncie użytkownika (progresywny lockout)
        const { rows: uRows } = await pool.query(
          `SELECT failed_login_attempts FROM users WHERE id = $1 LIMIT 1`,
          [req.user.id]
        );
        const nextAttempts = (uRows[0]?.failed_login_attempts || 0) + 1;
        const lockedUntil = computeLockoutUntil(nextAttempts);
        await pool.query(
          `UPDATE users
           SET failed_login_attempts = $2,
               locked_until = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [req.user.id, nextAttempts, lockedUntil]
        );

        const sessFail = await recordSessionMfaFailure(
          redis,
          req.sidHash,
          MAX_MFA_VERIFY_ATTEMPTS
        );
        if (sessFail.destroyed) {
          clearSessionCookie(res);
        }

        await logAudit(pool, {
          actorId: req.user.id,
          actorName: req.user.username,
          eventType,
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'FAILURE',
          metadata: {
            reason,
            sessionAttempts: sessFail.attempts,
            sessionDestroyed: sessFail.destroyed,
            ...extraMeta,
          },
        });

        if (sessFail.destroyed) {
          return res.status(401).json({
            error: 'MFA_SESSION_EXHAUSTED',
            message:
              'Przekroczono limit nieudanych prób weryfikacji MFA. Zaloguj się ponownie.',
          });
        }

        return res.status(httpStatus).json({
          error: errorCode,
          message,
        });
      };

      try {
        if (req.user.mfaVerified) {
          return res.status(400).json({ error: 'ALREADY_MFA_VERIFIED' });
        }

        const rl = await checkLoginIpRateLimit(redis, meta.ip);
        if (!rl.allowed) {
          res.setHeader('Retry-After', String(rl.retryAfterSeconds));
          return res.status(429).json({
            error: 'TOO_MANY_ATTEMPTS',
            retryAfterSeconds: rl.retryAfterSeconds,
          });
        }

        const parsed = loginVerifySchema.safeParse(req.body);
        if (!parsed.success || typeof parsed.data.response?.id !== 'string') {
          return handleMfaFailure({ reason: 'invalid_payload', httpStatus: 400 });
        }

        const expectedChallenge = await consumeWebAuthnChallenge(
          redis,
          'auth',
          req.sidHash
        );
        if (!expectedChallenge) {
          return handleMfaFailure({
            reason: 'challenge_missing_or_expired',
            errorCode: 'MFA_CHALLENGE_EXPIRED',
            message:
              'Wyzwanie weryfikacji wygasło lub zostało już użyte. Spróbuj ponownie.',
          });
        }

        const storedCredential = await getUserWebAuthnCredentialByCredentialId(
          pool,
          req.user.id,
          parsed.data.response.id
        );
        if (!storedCredential) {
          return handleMfaFailure({
            reason: 'unknown_credential',
            extraMeta: { credentialId: parsed.data.response.id.slice(0, 64) },
          });
        }

        const expectedOrigins = resolveExpectedOrigins(req, webauthnConfig);
        let verification;
        try {
          verification = await verifyAuthentication({
            response: parsed.data.response,
            expectedChallenge,
            expectedOrigins,
            storedCredential,
            config: webauthnConfig,
          });
        } catch (verifyErr) {
          const msg = String(verifyErr?.message || '');
          const isCounterAnomaly = msg.toLowerCase().includes('counter value');
          return handleMfaFailure({
            reason: isCounterAnomaly ? 'counter_regression' : 'verification_error',
            eventType: isCounterAnomaly
              ? 'AUTH_MFA_COUNTER_ANOMALY'
              : 'AUTH_MFA_LOGIN_FAILURE',
            extraMeta: {
              credentialDbId: storedCredential.id,
              credentialName: storedCredential.name,
              detail: msg.slice(0, 200),
            },
            errorCode: isCounterAnomaly
              ? 'MFA_COUNTER_ANOMALY'
              : 'MFA_VERIFICATION_FAILED',
            message: isCounterAnomaly
              ? 'Wykryto anomalię licznika klucza bezpieczeństwa (możliwe sklonowanie). Logowanie zostało zablokowane.'
              : 'Weryfikacja klucza bezpieczeństwa (lub PIN-u FIDO2) nie powiodła się.',
          });
        }

        if (!verification?.verified) {
          return handleMfaFailure({
            reason: 'signature_not_verified',
            extraMeta: { credentialDbId: storedCredential.id },
          });
        }

        // Dodatkowa jawna weryfikacja flagi UV przy trybie required
        if (
          webauthnConfig.requireUserVerification &&
          !verification.authenticationInfo.userVerified
        ) {
          return handleMfaFailure({
            reason: 'user_verification_missing',
            extraMeta: { credentialDbId: storedCredential.id },
            message: 'Wymagana jest weryfikacja użytkownika (PIN FIDO2 / biometria).',
          });
        }

        // Sprawdź czy konto nadal jest aktywne
        const { rows: userRows } = await pool.query(
          `SELECT id, username, role, is_active, must_change_password
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [req.user.id]
        );
        const dbUser = userRows[0];
        if (!dbUser || !dbUser.is_active) {
          clearSessionCookie(res);
          return res.status(401).json({ error: 'UNAUTHENTICATED' });
        }

        await updateWebAuthnCredentialUsage(pool, storedCredential.id, {
          counter: verification.authenticationInfo.newCounter,
          backedUp: verification.authenticationInfo.credentialBackedUp,
          deviceType: verification.authenticationInfo.credentialDeviceType,
        });

        await pool.query(
          `UPDATE users
           SET failed_login_attempts = 0,
               locked_until = NULL,
               last_login_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [dbUser.id]
        );

        // Regeneracja sesji po ukończeniu MFA (ASVS V3.2.1)
        const { sid, session, maxAgeSeconds } = await regenerateSession(
          redis,
          req.sid,
          dbUser,
          meta,
          { mfaVerified: true }
        );
        setSessionCookie(res, sid, maxAgeSeconds);

        const credentialsCount = await countUserWebAuthnCredentials(
          pool,
          dbUser.id
        );

        await logAudit(pool, {
          actorId: dbUser.id,
          actorName: dbUser.username,
          eventType: 'AUTH_MFA_LOGIN_SUCCESS',
          targetId: storedCredential.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'SUCCESS',
          metadata: {
            credentialName: storedCredential.name,
            aaguid: storedCredential.aaguid,
            newCounter: verification.authenticationInfo.newCounter,
            userVerified: verification.authenticationInfo.userVerified,
          },
        });

        return res.json({
          status: dbUser.must_change_password
            ? 'MUST_CHANGE_PASSWORD'
            : 'AUTHENTICATED',
          csrfToken: session.csrfToken,
          user: {
            id: dbUser.id,
            username: dbUser.username,
            role: dbUser.role,
            mustChangePassword: Boolean(dbUser.must_change_password),
            mfaVerified: true,
            mfaCredentialsCount: credentialsCount,
            mfaEnforcement: webauthnConfig.enforcement,
          },
        });
      } catch (err) {
        console.error('[MFA_LOGIN_VERIFY_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  // ==========================================================
  // REJESTRACJA I ZARZĄDZANIE KLUCZAMI (WYŁĄCZNIE SUPERADMIN)
  // ==========================================================

  // GET /api/auth/mfa/credentials
  router.get(
    '/credentials',
    requireFullSuperAdmin,
    requireSuperAdmin,
    async (req, res) => {
      try {
        const rows = await listUserWebAuthnCredentials(pool, req.user.id);
        return res.json({
          enforcement: webauthnConfig.enforcement,
          userVerification: webauthnConfig.userVerification,
          maxCredentials: MAX_WEBAUTHN_CREDENTIALS,
          credentials: rows.map(serializeCredentialForClient),
        });
      } catch (err) {
        console.error('[MFA_LIST_CREDENTIALS_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  // POST /api/auth/mfa/register/options
  router.post(
    '/register/options',
    requireMfaRegisterAllowed,
    requireSuperAdmin,
    requireCsrf,
    async (req, res) => {
      const meta = extractReqMeta(req);
      try {
        const parsed = registerOptionsSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({
            error: 'INVALID_PAYLOAD',
            message: 'Nieprawidłowe dane żądania.',
          });
        }

        const existingCredentials = await listUserWebAuthnCredentials(
          pool,
          req.user.id
        );

        if (existingCredentials.length >= MAX_WEBAUTHN_CREDENTIALS) {
          return res.status(409).json({
            error: 'MAX_CREDENTIALS_REACHED',
            message: `Osiągnięto maksymalny limit kluczy bezpieczeństwa (${MAX_WEBAUTHN_CREDENTIALS}).`,
          });
        }

        // Gdy użytkownik jest już w pełni zalogowany i ma aktywne klucze — wymagaj potwierdzenia hasłem (re-auth)
        const isEnrollmentStage = !req.user.mfaVerified && req.user.mfaStage === 'ENROLL';
        if (!isEnrollmentStage) {
          const passwordOk = await verifyUserCurrentPassword(
            pool,
            req.user.id,
            parsed.data.currentPassword
          );
          if (!passwordOk) {
            await logAudit(pool, {
              actorId: req.user.id,
              actorName: req.user.username,
              eventType: 'AUTH_MFA_KEY_REGISTER_REAUTH_FAILURE',
              ip: meta.ip,
              userAgent: meta.userAgent,
              status: 'FAILURE',
            });
            return res.status(400).json({
              error: 'CURRENT_PASSWORD_INVALID',
              message: 'Podaj poprawne aktualne hasło, aby dodać nowy klucz.',
            });
          }
        }

        const options = await buildRegistrationOptions({
          user: req.user,
          existingCredentials,
          config: webauthnConfig,
        });

        await saveWebAuthnChallenge(redis, 'reg', req.sidHash, options.challenge);
        return res.json({ options });
      } catch (err) {
        console.error('[MFA_REGISTER_OPTIONS_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  // POST /api/auth/mfa/register/verify
  router.post(
    '/register/verify',
    requireMfaRegisterAllowed,
    requireSuperAdmin,
    requireCsrf,
    async (req, res) => {
      const meta = extractReqMeta(req);
      try {
        const parsed = registerVerifySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: 'INVALID_PAYLOAD',
            message:
              parsed.error.issues[0]?.message ||
              'Podaj poprawną nazwę klucza oraz odpowiedź WebAuthn.',
          });
        }

        const existingCount = await countUserWebAuthnCredentials(pool, req.user.id);
        if (existingCount >= MAX_WEBAUTHN_CREDENTIALS) {
          return res.status(409).json({
            error: 'MAX_CREDENTIALS_REACHED',
            message: `Osiągnięto maksymalny limit kluczy bezpieczeństwa (${MAX_WEBAUTHN_CREDENTIALS}).`,
          });
        }

        const expectedChallenge = await consumeWebAuthnChallenge(
          redis,
          'reg',
          req.sidHash
        );
        if (!expectedChallenge) {
          return res.status(400).json({
            error: 'MFA_CHALLENGE_EXPIRED',
            message:
              'Sesja rejestracji klucza wygasła lub została już wykorzystana. Spróbuj ponownie.',
          });
        }

        const expectedOrigins = resolveExpectedOrigins(req, webauthnConfig);
        let verification;
        try {
          verification = await verifyRegistration({
            response: parsed.data.response,
            expectedChallenge,
            expectedOrigins,
            config: webauthnConfig,
          });
        } catch (verifyErr) {
          await logAudit(pool, {
            actorId: req.user.id,
            actorName: req.user.username,
            eventType: 'AUTH_MFA_KEY_REGISTER_FAILURE',
            ip: meta.ip,
            userAgent: meta.userAgent,
            status: 'FAILURE',
            metadata: { detail: String(verifyErr?.message || '').slice(0, 200) },
          });
          return res.status(400).json({
            error: 'MFA_REGISTRATION_FAILED',
            message:
              'Nie udało się zweryfikować klucza bezpieczeństwa. Upewnij się, że potwierdzono PIN FIDO2 / biometrię.',
          });
        }

        if (!verification?.verified || !verification.registrationInfo) {
          return res.status(400).json({
            error: 'MFA_REGISTRATION_FAILED',
            message: 'Rejestracja klucza bezpieczeństwa nie powiodła się.',
          });
        }

        const { registrationInfo } = verification;
        if (
          webauthnConfig.requireUserVerification &&
          !registrationInfo.userVerified
        ) {
          return res.status(400).json({
            error: 'USER_VERIFICATION_REQUIRED',
            message:
              'Klucz musi potwierdzić weryfikację użytkownika (PIN FIDO2 / biometria).',
          });
        }

        const transports = Array.isArray(registrationInfo.credential.transports)
          ? registrationInfo.credential.transports
          : Array.isArray(parsed.data.response?.response?.transports)
            ? parsed.data.response.response.transports
            : [];

        let inserted;
        try {
          inserted = await insertWebAuthnCredential(pool, {
            userId: req.user.id,
            credentialId: registrationInfo.credential.id,
            publicKey: registrationInfo.credential.publicKey,
            counter: registrationInfo.credential.counter,
            transports,
            deviceType: registrationInfo.credentialDeviceType,
            backedUp: registrationInfo.credentialBackedUp,
            aaguid: registrationInfo.aaguid,
            name: parsed.data.name,
          });
        } catch (dbErr) {
          if (dbErr?.code === '23505') {
            return res.status(409).json({
              error: 'CREDENTIAL_ALREADY_REGISTERED',
              message: 'Ten klucz bezpieczeństwa jest już zarejestrowany.',
            });
          }
          throw dbErr;
        }

        const totalCredentials = existingCount + 1;
        const wasEnrollmentStage =
          !req.user.mfaVerified && req.user.mfaStage === 'ENROLL';

        await logAudit(pool, {
          actorId: req.user.id,
          actorName: req.user.username,
          eventType: 'AUTH_MFA_KEY_REGISTERED',
          targetId: inserted.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'SUCCESS',
          metadata: {
            credentialName: inserted.name,
            aaguid: inserted.aaguid,
            deviceType: inserted.device_type,
            transports: inserted.transports,
            enrollmentFlow: wasEnrollmentStage,
            totalCredentials,
          },
        });

        if (wasEnrollmentStage) {
          const { rows: userRows } = await pool.query(
            `SELECT id, username, role, is_active, must_change_password
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [req.user.id]
          );
          const dbUser = userRows[0];
          if (!dbUser || !dbUser.is_active) {
            clearSessionCookie(res);
            return res.status(401).json({ error: 'UNAUTHENTICATED' });
          }

          await pool.query(
            `UPDATE users
             SET failed_login_attempts = 0,
                 locked_until = NULL,
                 last_login_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [dbUser.id]
          );

          const { sid, session, maxAgeSeconds } = await regenerateSession(
            redis,
            req.sid,
            dbUser,
            meta,
            { mfaVerified: true }
          );
          setSessionCookie(res, sid, maxAgeSeconds);

          return res.status(201).json({
            status: dbUser.must_change_password
              ? 'MUST_CHANGE_PASSWORD'
              : 'AUTHENTICATED',
            csrfToken: session.csrfToken,
            credential: serializeCredentialForClient(inserted),
            user: {
              id: dbUser.id,
              username: dbUser.username,
              role: dbUser.role,
              mustChangePassword: Boolean(dbUser.must_change_password),
              mfaVerified: true,
              mfaCredentialsCount: totalCredentials,
              mfaEnforcement: webauthnConfig.enforcement,
            },
          });
        }

        return res.status(201).json({
          credential: serializeCredentialForClient(inserted),
          mfaCredentialsCount: totalCredentials,
        });
      } catch (err) {
        console.error('[MFA_REGISTER_VERIFY_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  // PATCH /api/auth/mfa/credentials/:id — zmiana nazwy klucza
  router.patch(
    '/credentials/:id',
    requireFullSuperAdmin,
    requireSuperAdmin,
    requireCsrf,
    async (req, res) => {
      const meta = extractReqMeta(req);
      try {
        if (!uuidSchema.safeParse(req.params.id).success) {
          return res.status(400).json({ error: 'INVALID_CREDENTIAL_ID' });
        }
        const parsed = renameSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: 'INVALID_PAYLOAD',
            message:
              parsed.error.issues[0]?.message || 'Podaj poprawną nazwę klucza.',
          });
        }

        const updated = await renameWebAuthnCredential(
          pool,
          req.user.id,
          req.params.id,
          parsed.data.name
        );
        if (!updated) {
          return res.status(404).json({ error: 'CREDENTIAL_NOT_FOUND' });
        }

        await logAudit(pool, {
          actorId: req.user.id,
          actorName: req.user.username,
          eventType: 'AUTH_MFA_KEY_RENAMED',
          targetId: updated.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'SUCCESS',
          metadata: { newName: updated.name },
        });

        return res.json({ credential: serializeCredentialForClient(updated) });
      } catch (err) {
        console.error('[MFA_RENAME_CREDENTIAL_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  // DELETE /api/auth/mfa/credentials/:id — usunięcie klucza (z potwierdzeniem hasłem)
  router.delete(
    '/credentials/:id',
    requireFullSuperAdmin,
    requireSuperAdmin,
    requireCsrf,
    async (req, res) => {
      const meta = extractReqMeta(req);
      try {
        if (!uuidSchema.safeParse(req.params.id).success) {
          return res.status(400).json({ error: 'INVALID_CREDENTIAL_ID' });
        }
        const parsed = deleteSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({
            error: 'INVALID_PAYLOAD',
            message: 'Podaj aktualne hasło, aby usunąć klucz bezpieczeństwa.',
          });
        }

        const passwordOk = await verifyUserCurrentPassword(
          pool,
          req.user.id,
          parsed.data.currentPassword
        );
        if (!passwordOk) {
          return res.status(400).json({
            error: 'CURRENT_PASSWORD_INVALID',
            message: 'Aktualne hasło jest nieprawidłowe.',
          });
        }

        const count = await countUserWebAuthnCredentials(pool, req.user.id);
        if (webauthnConfig.enforcement === 'required' && count <= 1) {
          return res.status(409).json({
            error: 'LAST_MFA_KEY_PROTECTED',
            message:
              'Nie można usunąć ostatniego klucza bezpieczeństwa. Dodaj najpierw nowy klucz, a następnie usuń poprzedni.',
          });
        }

        const deleted = await deleteWebAuthnCredential(
          pool,
          req.user.id,
          req.params.id
        );
        if (!deleted) {
          return res.status(404).json({ error: 'CREDENTIAL_NOT_FOUND' });
        }

        // Unieważnij wszystkie inne sesje (zostaw bieżącą)
        const revoked = await revokeAllUserSessions(
          redis,
          req.user.id,
          req.sidHash
        );

        await logAudit(pool, {
          actorId: req.user.id,
          actorName: req.user.username,
          eventType: 'AUTH_MFA_KEY_DELETED',
          targetId: deleted.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          status: 'SUCCESS',
          metadata: {
            credentialName: deleted.name,
            remainingCredentials: Math.max(0, count - 1),
            revokedOtherSessions: revoked,
          },
        });

        return res.json({
          deleted: true,
          remainingCredentials: Math.max(0, count - 1),
          revokedOtherSessions: revoked,
        });
      } catch (err) {
        console.error('[MFA_DELETE_CREDENTIAL_ERROR]', err.message);
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }
  );

  return router;
}

