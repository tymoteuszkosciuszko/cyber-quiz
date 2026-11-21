// OWASP ASVS V2.1: Polityka haseł i walidacja nazw użytkowników

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

// Lista popularnych/złamanych haseł (w tym warianty >= 12 znaków oraz polskie hasła)
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '1234567890123456',
  '000000000000',
  '111111111111',
  'aaaaaaaaaaaa',
  'password1234',
  'password12345',
  'password123456',
  'qwerty123456',
  'qwertyuiop12',
  'qwertyuiopas',
  'qwertyuiopasdf',
  'adminadmin12',
  'admin1234567',
  'admin12345678',
  'administrator',
  'administrator1',
  'administrator123',
  'superadmin12',
  'superadmin123',
  'cyberquiz123',
  'cyberquiz2025',
  'cyberquiz2026',
  'cyber-quiz123',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'trustno12345',
  'zaq12wsxcde3',
  'zaq1@wsxcde3',
  'polska123456',
  'warszawa1234',
  'haslo1234567',
  'haslo12345678',
  'tajnehaslo12',
  'tajnehaslo123',
  'bezpieczenstwo',
  'changeme1234',
  'correcthorsebatterystaple',
  'p@ssw0rd1234',
  'passw0rd1234',
]);

export function normalizePassword(raw) {
  if (typeof raw !== 'string') return '';
  // Normalizacja NFKC bez obcinania i bez usuwania spacji (ASVS V2.1.1 / V2.1.4)
  return raw.normalize('NFKC');
}

export function validatePassword(rawPassword, username = '') {
  if (typeof rawPassword !== 'string') {
    return {
      valid: false,
      code: 'PASSWORD_REQUIRED',
      message: 'Hasło jest wymagane.',
    };
  }

  const normalized = normalizePassword(rawPassword);

  if (normalized.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      code: 'PASSWORD_TOO_SHORT',
      message: `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`,
    };
  }

  if (normalized.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      code: 'PASSWORD_TOO_LONG',
      message: `Hasło może mieć maksymalnie ${MAX_PASSWORD_LENGTH} znaków.`,
    };
  }

  const lower = normalized.toLowerCase();
  const compact = lower.replace(/\s+/g, '');

  // Odrzuć hasła złożone z jednego powtarzanego znaku (np. "aaaaaaaaaaaa")
  if (new Set(compact).size < 3) {
    return {
      valid: false,
      code: 'PASSWORD_TOO_WEAK',
      message: 'Hasło jest zbyt proste — użyj bardziej zróżnicowanych znaków.',
    };
  }

  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(compact)) {
    return {
      valid: false,
      code: 'PASSWORD_COMMON',
      message: 'To hasło znajduje się na liście popularnych haseł. Wybierz inne.',
    };
  }

  const cleanUser = String(username || '').trim().toLowerCase();
  if (cleanUser.length >= 3 && lower.includes(cleanUser)) {
    return {
      valid: false,
      code: 'PASSWORD_CONTAINS_USERNAME',
      message: 'Hasło nie może zawierać nazwy użytkownika.',
    };
  }

  return { valid: true, normalized };
}

export function validateUsername(rawUsername) {
  if (typeof rawUsername !== 'string') {
    return {
      valid: false,
      code: 'INVALID_USERNAME',
      message: 'Nazwa użytkownika jest wymagana.',
    };
  }
  const username = rawUsername.trim();
  if (username.length < 3 || username.length > 32) {
    return {
      valid: false,
      code: 'INVALID_USERNAME',
      message: 'Nazwa użytkownika musi mieć od 3 do 32 znaków.',
    };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return {
      valid: false,
      code: 'INVALID_USERNAME',
      message: 'Dozwolone znaki w loginie: litery A-Z, cyfry oraz . _ -',
    };
  }
  return {
    valid: true,
    username,
    normalized: username.toLowerCase(),
  };
}

