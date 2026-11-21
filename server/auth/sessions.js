import cookie from 'cookie';
import {
  generateCsrfToken,
  generateSessionId,
  hashSessionId,
} from './crypto.js';

export const COOKIE_SECURE =
  process.env.COOKIE_SECURE !== undefined
    ? ['1', 'true', 'yes'].includes(process.env.COOKIE_SECURE.toLowerCase())
    : process.env.NODE_ENV === 'production';

// Prefiks __Host- wymusza Secure + Path=/ + brak Domain (ASVS V3.4.5)
export const SESSION_COOKIE_NAME = COOKIE_SECURE ? '__Host-cq_sid' : 'cq_sid';

const IDLE_TTL_ADMIN = Math.max(
  300,
  Number(process.env.SESSION_IDLE_TTL_ADMIN) || 3600
);
const IDLE_TTL_SUPERADMIN = Math.max(
  300,
  Number(process.env.SESSION_IDLE_TTL_SUPERADMIN) || 1800
);
const ABSOLUTE_TTL = Math.max(
  1800,
  Number(process.env.SESSION_ABSOLUTE_TTL) || 28800
);

function sessionKey(sidHash) {
  return `auth:sess:${sidHash}`;
}

function userSessionsKey(userId) {
  return `auth:user_sessions:${userId}`;
}

function getIdleTtlForRole(role) {
  return role === 'superadmin' ? IDLE_TTL_SUPERADMIN : IDLE_TTL_ADMIN;
}

export function getSessionCookieFromHeaders(headers = {}) {
  const raw = headers?.cookie;
  if (!raw || typeof raw !== 'string') return null;
  const parsed = cookie.parse(raw);
  return parsed[SESSION_COOKIE_NAME] || null;
}

export function setSessionCookie(res, sid, maxAgeSeconds = ABSOLUTE_TTL) {
  res.cookie(SESSION_COOKIE_NAME, sid, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

export async function createSession(redis, user, meta = {}) {
  const sid = generateSessionId();
  const sidHash = hashSessionId(sid);
  const now = Date.now();
  const idleTtl = getIdleTtlForRole(user.role);
  const absoluteExpiresAt = now + ABSOLUTE_TTL * 1000;

  const session = {
    userId: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password ?? user.mustChangePassword),
    // Punkt zaczepienia pod przyszłe wdrożenie WebAuthn/YubiKey (Etap 2)
    mfaVerified: true,
    csrfToken: generateCsrfToken(),
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt,
    ip: meta.ip || null,
    ua: meta.userAgent ? String(meta.userAgent).slice(0, 200) : null,
  };

  await redis.set(sessionKey(sidHash), JSON.stringify(session), 'EX', idleTtl);
  await redis.sadd(userSessionsKey(user.id), sidHash);
  await redis.expire(userSessionsKey(user.id), ABSOLUTE_TTL + 60);

  return { sid, sidHash, session, maxAgeSeconds: ABSOLUTE_TTL };
}

export async function getSessionByHash(redis, sidHash, { touch = true } = {}) {
  if (!sidHash) return null;
  const raw = await redis.get(sessionKey(sidHash));
  if (!raw) return null;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    await redis.del(sessionKey(sidHash));
    return null;
  }

  const now = Date.now();
  if (!session.absoluteExpiresAt || now >= session.absoluteExpiresAt) {
    await redis.del(sessionKey(sidHash));
    if (session.userId) {
      await redis.srem(userSessionsKey(session.userId), sidHash);
    }
    return null;
  }

  if (touch) {
    const remainingAbsSec = Math.max(
      1,
      Math.floor((session.absoluteExpiresAt - now) / 1000)
    );
    const nextTtl = Math.min(getIdleTtlForRole(session.role), remainingAbsSec);
    session.lastSeenAt = now;
    await redis.set(sessionKey(sidHash), JSON.stringify(session), 'EX', nextTtl);
  }

  return { sidHash, session };
}

export async function getSession(redis, sid, options = {}) {
  if (!sid || typeof sid !== 'string') return null;
  return getSessionByHash(redis, hashSessionId(sid), options);
}

export async function destroySession(redis, sid) {
  if (!sid) return;
  const sidHash = hashSessionId(sid);
  const existing = await getSessionByHash(redis, sidHash, { touch: false });
  await redis.del(sessionKey(sidHash));
  if (existing?.session?.userId) {
    await redis.srem(userSessionsKey(existing.session.userId), sidHash);
  }
}

export async function regenerateSession(redis, oldSid, user, meta = {}) {
  if (oldSid) {
    await destroySession(redis, oldSid);
  }
  return createSession(redis, user, meta);
}

export async function revokeAllUserSessions(redis, userId, exceptSidHash = null) {
  if (!userId) return 0;
  const key = userSessionsKey(userId);
  const hashes = await redis.smembers(key);
  if (!hashes || hashes.length === 0) return 0;

  let revoked = 0;
  const pipeline = redis.pipeline();
  for (const h of hashes) {
    if (exceptSidHash && h === exceptSidHash) continue;
    pipeline.del(sessionKey(h));
    pipeline.srem(key, h);
    revoked++;
  }
  await pipeline.exec();
  return revoked;
}

