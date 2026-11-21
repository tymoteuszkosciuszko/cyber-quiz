import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

export const MAX_WEBAUTHN_CREDENTIALS = 10;
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 180;
export const PRE_MFA_VERIFY_TTL_SECONDS = 300;
export const PRE_MFA_ENROLL_TTL_SECONDS = 600;
export const MAX_MFA_VERIFY_ATTEMPTS = 5;

// Standardowe algorytmy COSE wspierane przez YubiKey 5, Security Key, Touch ID i Windows Hello
// ES256 (-7), EdDSA (-8), RS256 (-257)
const SUPPORTED_COSE_ALGS = [-7, -8, -257];

function parseOriginList(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function deriveRpIdFromOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function getWebAuthnConfig({
  allowedOrigins = '*',
  isProd = process.env.NODE_ENV === 'production',
  port = Number(process.env.PORT) || 3001,
} = {}) {
  const rpName = (process.env.WEBAUTHN_RP_NAME || 'Cyber Quiz').trim() || 'Cyber Quiz';

  const rawEnforcement = (
    process.env.SUPERADMIN_MFA_ENFORCEMENT || 'required'
  )
    .trim()
    .toLowerCase();
  const enforcement = rawEnforcement === 'optional' ? 'optional' : 'required';

  const rawUv = (process.env.WEBAUTHN_USER_VERIFICATION || 'required')
    .trim()
    .toLowerCase();
  const userVerification =
    rawUv === 'preferred' || rawUv === 'discouraged' ? rawUv : 'required';

  const explicitOrigins = parseOriginList(process.env.WEBAUTHN_ORIGIN || '');
  let expectedOrigins = [];

  if (explicitOrigins.length > 0) {
    expectedOrigins = explicitOrigins;
  } else if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0) {
    expectedOrigins = allowedOrigins.map((o) => o.replace(/\/+$/, ''));
  } else if (!isProd) {
    expectedOrigins = Array.from(
      new Set([
        'http://localhost:5173',
        'http://localhost:3001',
        `http://localhost:${port}`,
      ])
    );
  }

  let rpID = (process.env.WEBAUTHN_RP_ID || '').trim().toLowerCase();
  if (!rpID) {
    if (expectedOrigins.length > 0) {
      rpID = deriveRpIdFromOrigin(expectedOrigins[0]) || (isProd ? '' : 'localhost');
    } else if (!isProd) {
      rpID = 'localhost';
    }
  }

  if (isProd) {
    if (!rpID || expectedOrigins.length === 0) {
      throw new Error(
        '[SECURITY_CONFIG_ERROR] W produkcji wymagana jest poprawna konfiguracja WebAuthn (WEBAUTHN_RP_ID lub HTTPS CORS_ORIGIN).'
      );
    }
    const invalidOrigin = expectedOrigins.find((o) => !o.startsWith('https://'));
    if (invalidOrigin) {
      throw new Error(
        `[SECURITY_CONFIG_ERROR] W produkcji wszystkie WEBAUTHN_ORIGIN muszą używać HTTPS (wykryto: ${invalidOrigin}).`
      );
    }
  }

  return {
    rpName,
    rpID: rpID || 'localhost',
    expectedOrigins,
    enforcement,
    userVerification,
    requireUserVerification: userVerification === 'required',
    isProd,
  };
}

export function resolveExpectedOrigins(req, config) {
  if (config.isProd) {
    return config.expectedOrigins;
  }

  const origins = new Set(config.expectedOrigins);
  const reqOrigin = req?.headers?.origin;
  if (typeof reqOrigin === 'string') {
    try {
      const parsed = new URL(reqOrigin);
      if (parsed.hostname === 'localhost' && parsed.protocol === 'http:') {
        origins.add(parsed.origin);
      }
    } catch {
      // ignore invalid origin
    }
  }
  return Array.from(origins);
}

function challengeKey(scope, sidHash) {
  return `auth:webauthn:${scope}:${sidHash}`;
}

export async function saveWebAuthnChallenge(redis, scope, sidHash, challenge) {
  await redis.set(
    challengeKey(scope, sidHash),
    String(challenge),
    'EX',
    WEBAUTHN_CHALLENGE_TTL_SECONDS
  );
}

export async function consumeWebAuthnChallenge(redis, scope, sidHash) {
  const key = challengeKey(scope, sidHash);
  const challenge = await redis.getdel(key);
  return challenge || null;
}

export async function countUserWebAuthnCredentials(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM webauthn_credentials WHERE user_id = $1`,
    [userId]
  );
  return rows[0]?.count || 0;
}

export async function listUserWebAuthnCredentials(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id, credential_id, public_key, counter, transports,
            device_type, backed_up, aaguid, name, created_at, last_used_at
     FROM webauthn_credentials
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

export async function getUserWebAuthnCredentialByCredentialId(
  pool,
  userId,
  credentialId
) {
  const { rows } = await pool.query(
    `SELECT id, credential_id, public_key, counter, transports,
            device_type, backed_up, aaguid, name, created_at, last_used_at
     FROM webauthn_credentials
     WHERE user_id = $1 AND credential_id = $2
     LIMIT 1`,
    [userId, credentialId]
  );
  return rows[0] || null;
}

export async function insertWebAuthnCredential(
  pool,
  {
    userId,
    credentialId,
    publicKey,
    counter = 0,
    transports = [],
    deviceType = 'singleDevice',
    backedUp = false,
    aaguid = null,
    name,
  }
) {
  const { rows } = await pool.query(
    `INSERT INTO webauthn_credentials
       (user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, credential_id, counter, transports, device_type, backed_up, aaguid, name, created_at, last_used_at`,
    [
      userId,
      credentialId,
      Buffer.from(publicKey),
      Number(counter) || 0,
      Array.isArray(transports) ? transports : [],
      deviceType || 'singleDevice',
      Boolean(backedUp),
      aaguid || null,
      name,
    ]
  );
  return rows[0];
}

export async function updateWebAuthnCredentialUsage(
  pool,
  id,
  { counter, backedUp, deviceType }
) {
  await pool.query(
    `UPDATE webauthn_credentials
     SET counter = $2,
         backed_up = $3,
         device_type = $4,
         last_used_at = NOW()
     WHERE id = $1`,
    [id, Number(counter) || 0, Boolean(backedUp), deviceType || 'singleDevice']
  );
}

export async function renameWebAuthnCredential(pool, userId, id, name) {
  const { rows } = await pool.query(
    `UPDATE webauthn_credentials
     SET name = $3
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, transports, device_type, backed_up, aaguid, created_at, last_used_at`,
    [id, userId, name]
  );
  return rows[0] || null;
}

export async function deleteWebAuthnCredential(pool, userId, id) {
  const { rows } = await pool.query(
    `DELETE FROM webauthn_credentials
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, credential_id`,
    [id, userId]
  );
  return rows[0] || null;
}

export function serializeCredentialForClient(row) {
  return {
    id: row.id,
    name: row.name,
    transports: Array.isArray(row.transports) ? row.transports : [],
    deviceType: row.device_type || 'singleDevice',
    backedUp: Boolean(row.backed_up),
    aaguid: row.aaguid || null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
  };
}

export async function buildRegistrationOptions({ user, existingCredentials, config }) {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.username,
    userDisplayName: user.username,
    userID: new TextEncoder().encode(user.id),
    timeout: 90_000,
    attestationType: 'none',
    supportedAlgorithmIDs: SUPPORTED_COSE_ALGS,
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.credential_id,
      transports: Array.isArray(cred.transports) ? cred.transports : undefined,
    })),
    authenticatorSelection: {
      // Brak ograniczenia authenticatorAttachment: dopuszcza YubiKey, inne klucze sprzętowe oraz Touch ID / Windows Hello
      residentKey: 'preferred',
      userVerification: config.userVerification,
    },
  });
}

export async function buildAuthenticationOptions({ existingCredentials, config }) {
  return generateAuthenticationOptions({
    rpID: config.rpID,
    timeout: 90_000,
    userVerification: config.userVerification,
    allowCredentials: existingCredentials.map((cred) => ({
      id: cred.credential_id,
      transports: Array.isArray(cred.transports) ? cred.transports : undefined,
    })),
  });
}

export async function verifyRegistration({
  response,
  expectedChallenge,
  expectedOrigins,
  config,
}) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins,
    expectedRPID: config.rpID,
    requireUserPresence: true,
    requireUserVerification: config.requireUserVerification,
    supportedAlgorithmIDs: SUPPORTED_COSE_ALGS,
  });
}

export async function verifyAuthentication({
  response,
  expectedChallenge,
  expectedOrigins,
  storedCredential,
  config,
}) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins,
    expectedRPID: config.rpID,
    requireUserVerification: config.requireUserVerification,
    credential: {
      id: storedCredential.credential_id,
      publicKey: new Uint8Array(storedCredential.public_key),
      counter: Number(storedCredential.counter) || 0,
      transports: Array.isArray(storedCredential.transports)
        ? storedCredential.transports
        : undefined,
    },
  });
}

