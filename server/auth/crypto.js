import crypto from 'node:crypto';
import argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet / ASVS V2.4.1 — Argon2id
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise = null;

export async function hashPassword(normalizedPassword) {
  return argon2.hash(normalizedPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash, normalizedPassword) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  try {
    return await argon2.verify(storedHash, normalizedPassword);
  } catch {
    return false;
  }
}

// Stały czas odpowiedzi dla nieistniejących użytkowników (ochrona przed enumeracją kont)
export function getDummyPasswordHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(
      `dummy-${crypto.randomBytes(24).toString('hex')}`
    );
  }
  return dummyHashPromise;
}

export function generateSessionId() {
  return crypto.randomBytes(32).toString('base64url'); // 256 bitów entropii
}

export function hashSessionId(sid) {
  return crypto.createHash('sha256').update(String(sid)).digest('hex');
}

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Generator hasła tymczasowego (16 znaków bez mylących O/0/I/l/1)
const TEMP_PWD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';

export function generateTempPassword(length = 16) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TEMP_PWD_ALPHABET[crypto.randomInt(0, TEMP_PWD_ALPHABET.length)];
  }
  return out;
}

