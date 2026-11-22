#!/usr/bin/env node
/**
 * Automatyczne testy dymne, E2E i bezpieczeństwa (OWASP ASVS)
 * dla aplikacji Cyber Quiz (REST API + Auth + RBAC + Izolacja + SPA + Socket.IO + Redis + PostgreSQL).
 *
 * Użycie:
 *   node scripts/smoke-test.mjs                 # sam uruchamia serwer na wolnym porcie
 *   node scripts/smoke-test.mjs --url http://127.0.0.1:3001
 *   node scripts/smoke-test.mjs --skip-static   # pomija sprawdzenie client/dist
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
let io;
try {
  ({ io } = require('socket.io-client'));
} catch {
  try {
    const clientRequire = createRequire(
      new URL('../client/package.json', import.meta.url)
    );
    ({ io } = clientRequire('socket.io-client'));
  } catch (err) {
    console.error(
      'Błąd: nie znaleziono pakietu "socket.io-client". Uruchom "npm ci" w katalogu client/.'
    );
    console.error(err.message);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const opts = {
    url: null,
    port: Number(process.env.TEST_PORT) || 3199,
    skipStatic: false,
    superadminUser: process.env.SMOKE_SUPERADMIN_USER || 'superadmin',
    superadminPass:
      process.env.SMOKE_SUPERADMIN_PASS || 'CyberQuiz_SuperSecret_2026!',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      opts.url = argv[++i].replace(/\/$/, '');
    } else if (arg === '--port' && argv[i + 1]) {
      opts.port = Number(argv[++i]);
    } else if (arg === '--skip-static') {
      opts.skipStatic = true;
    } else if (arg === '--username' && argv[i + 1]) {
      opts.superadminUser = argv[++i];
    } else if (arg === '--password' && argv[i + 1]) {
      opts.superadminPass = argv[++i];
    }
  }
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractCookiePair(res) {
  const setCookie =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  for (const header of setCookie) {
    const first = header.split(';')[0];
    if (first && first.includes('cq_sid=')) {
      return { pair: first, raw: header };
    }
  }
  return { pair: '', raw: '' };
}

class AuthClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.csrfToken = '';
    this.lastRawSetCookie = '';
  }

  async request(urlPath, { method = 'GET', body, csrf = true, headers = {} } = {}) {
    const reqHeaders = { ...headers };
    if (this.cookie) reqHeaders.Cookie = this.cookie;
    if (csrf && this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      reqHeaders['X-CSRF-Token'] = this.csrfToken;
    }
    let payload = body;
    if (body !== undefined && typeof body !== 'string') {
      reqHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers: reqHeaders,
      body: payload,
    });

    const { pair, raw } = extractCookiePair(res);
    if (pair) {
      this.cookie = pair;
      this.lastRawSetCookie = raw;
    }

    const data = await res.json().catch(() => ({}));
    if (data?.csrfToken) {
      this.csrfToken = data.csrfToken;
    }
    return { res, data };
  }

  async login(username, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      csrf: false,
    });
  }
}

// =========================================================================
// Programowy wirtualny autentykator FIDO2 (ES256 / COSE) do testów WebAuthn
// =========================================================================
function cborEncodeUint(majorType, value) {
  const mt = majorType << 5;
  if (value < 24) return Buffer.from([mt | value]);
  if (value < 256) return Buffer.from([mt | 24, value]);
  if (value < 65536) {
    const b = Buffer.alloc(3);
    b[0] = mt | 25;
    b.writeUInt16BE(value, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = mt | 26;
  b.writeUInt32BE(value, 1);
  return b;
}

function cborEncodeInt(n) {
  if (n >= 0) return cborEncodeUint(0, n);
  return cborEncodeUint(1, -1 - n);
}

function cborEncodeBytes(buf) {
  return Buffer.concat([cborEncodeUint(2, buf.length), buf]);
}

function cborEncodeText(str) {
  const buf = Buffer.from(str, 'utf8');
  return Buffer.concat([cborEncodeUint(3, buf.length), buf]);
}

function cborEncodeMap(entries) {
  return Buffer.concat([
    cborEncodeUint(5, entries.length),
    ...entries.flatMap(([k, v]) => [k, v]),
  ]);
}

class VirtualFido2Key {
  constructor({ transports = ['usb', 'nfc'], initialCounter = 1 } = {}) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.x = Buffer.from(jwk.x, 'base64url');
    this.y = Buffer.from(jwk.y, 'base64url');
    this.credentialIdBuf = crypto.randomBytes(32);
    this.credentialId = this.credentialIdBuf.toString('base64url');
    this.transports = transports;
    this.counter = initialCounter;
    this.aaguid = Buffer.from('f8a011f38c0a4d15800617111f9edc7d', 'hex');
  }

  getCosePublicKey() {
    return cborEncodeMap([
      [cborEncodeInt(1), cborEncodeInt(2)], // kty: EC2
      [cborEncodeInt(3), cborEncodeInt(-7)], // alg: ES256
      [cborEncodeInt(-1), cborEncodeInt(1)], // crv: P-256
      [cborEncodeInt(-2), cborEncodeBytes(this.x)],
      [cborEncodeInt(-3), cborEncodeBytes(this.y)],
    ]);
  }

  createRegistrationResponse(
    options,
    { origin, rpId = options.rp.id, uv = true, up = true } = {}
  ) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
      'utf8'
    );

    const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
    const flags = (up ? 0x01 : 0) | (uv ? 0x04 : 0) | 0x40; // UP | UV | AT
    const signCountBuf = Buffer.alloc(4);
    signCountBuf.writeUInt32BE(this.counter, 0);
    const credIdLenBuf = Buffer.alloc(2);
    credIdLenBuf.writeUInt16BE(this.credentialIdBuf.length, 0);

    const authData = Buffer.concat([
      rpIdHash,
      Buffer.from([flags]),
      signCountBuf,
      this.aaguid,
      credIdLenBuf,
      this.credentialIdBuf,
      this.getCosePublicKey(),
    ]);

    const attestationObject = cborEncodeMap([
      [cborEncodeText('fmt'), cborEncodeText('none')],
      [cborEncodeText('attStmt'), cborEncodeMap([])],
      [cborEncodeText('authData'), cborEncodeBytes(authData)],
    ]);

    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: this.transports,
      },
      clientExtensionResults: {},
    };
  }

  createAuthenticationResponse(
    options,
    {
      origin,
      rpId = options.rpId,
      uv = true,
      up = true,
      counterOverride = null,
    } = {}
  ) {
    const nextCounter =
      counterOverride !== null ? counterOverride : ++this.counter;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
      'utf8'
    );

    const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
    const flags = (up ? 0x01 : 0) | (uv ? 0x04 : 0);
    const signCountBuf = Buffer.alloc(4);
    signCountBuf.writeUInt32BE(nextCounter, 0);
    const authData = Buffer.concat([
      rpIdHash,
      Buffer.from([flags]),
      signCountBuf,
    ]);

    const clientDataHash = crypto
      .createHash('sha256')
      .update(clientDataJSON)
      .digest();
    const signature = crypto.sign(
      'sha256',
      Buffer.concat([authData, clientDataHash]),
      this.privateKey
    );

    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
      },
      clientExtensionResults: {},
    };
  }
}

function waitForEvent(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(
        new Error(
          `Timeout (${timeoutMs}ms) podczas oczekiwania na zdarzenie "${event}"`
        )
      );
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

function emitWithAck(socket, event, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms) podczas ACK dla "${event}"`));
    }, timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function connectSocket(baseUrl, cookie = '') {
  const socket = io(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout połączenia WebSocket')),
      6000
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return socket;
}

function ensureSuperadminBootstrapped(username, password) {
  const scriptPath = path.join(
    ROOT_DIR,
    'server',
    'scripts',
    'bootstrap-superadmin.mjs'
  );
  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: path.join(ROOT_DIR, 'server'),
      env: {
        ...process.env,
        SUPERADMIN_USERNAME: username,
        SUPERADMIN_PASSWORD: password,
      },
      stdio: 'pipe',
    });
    return true; // Utworzono tymczasowego superadmina na potrzeby tego testu
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    if (!stderr.includes('już istnieje')) {
      throw new Error(`Bootstrap superadmina nie powiódł się:\n${stderr}`);
    }
    return false;
  }
}

async function cleanupBootstrappedSuperadmin(username) {
  const { createPool } = await import('../server/db/pool.js');
  const pool = createPool();
  try {
    await pool.query(
      `DELETE FROM users WHERE role = 'superadmin' AND username_normalized = $1`,
      [username.toLowerCase()]
    );
  } finally {
    await pool.end();
  }
}

async function startServer(port) {
  const serverEntry = path.join(ROOT_DIR, 'server', 'index.js');
  const staticDir = path.join(ROOT_DIR, 'client', 'dist');
  const logs = [];

  const child = spawn(process.execPath, [serverEntry], {
    cwd: path.join(ROOT_DIR, 'server'),
    env: {
      ...process.env,
      PORT: String(port),
      REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
      REDIS_PORT: process.env.REDIS_PORT || '6379',
      COOKIE_SECURE: 'false',
      STATIC_DIR: staticDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Serwer zakończył działanie przedwcześnie (kod ${child.exitCode}).\n${logs.join('')}`
      );
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return { child, baseUrl, logs };
      }
    } catch {
      // Serwer jeszcze wstaje
    }
    await sleep(250);
  }

  child.kill('SIGTERM');
  throw new Error(
    `Serwer nie odpowiedział na /health w ciągu 15s.\n${logs.join('')}`
  );
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(killer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function runTests(
  baseUrl,
  { skipStatic, superadminUser, superadminPass, createdTempSuperadmin = false }
) {
  let passed = 0;
  const parsedBase = new URL(baseUrl);
  const webauthnOrigin = `http://localhost:${parsedBase.port || 3001}`;

  const step = async (name, fn) => {
    const start = Date.now();
    await fn();
    passed++;
    console.log(`  [OK] ${name} (${Date.now() - start}ms)`);
  };

  console.log(`\nUruchamianie testów Cyber Quiz przeciwko ${baseUrl}...\n`);

  // 1. Healthcheck + nagłówki bezpieczeństwa (helmet)
  await step('GET /health zwraca 200 (Redis + Postgres) i nagłówki bezpieczeństwa', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp);
    assert.match(csp, /img-src[^;]*\bblob:/);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.redis, 'ready');
    assert.equal(body.postgres, 'ready');
  });

  // 2. Serwowanie zbudowanego SPA
  const distIndex = path.join(ROOT_DIR, 'client', 'dist', 'index.html');
  if (!skipStatic && fs.existsSync(distIndex)) {
    await step('Serwowanie statycznego SPA (/, /game-admin, /game-screen)', async () => {
      for (const route of ['/', '/game-admin', '/game-screen']) {
        const res = await fetch(`${baseUrl}${route}`);
        assert.equal(res.status, 200, `Ścieżka ${route} powinna zwrócić 200`);
        const html = await res.text();
        assert.match(html, /<!doctype html>/i);
        assert.match(html, /id="root"/);
      }
    });
  } else {
    console.log(
      '  [SKIP] Test statycznego SPA pominięty (brak client/dist lub flaga --skip-static)'
    );
  }

  // 3. Ochrona przed dostępem bez uwierzytelniania (REST + Socket.IO)
  await step('Odmowa dostępu bez logowania (REST 401 + Socket.IO UNAUTHORIZED)', async () => {
    for (const ep of ['/api/quizzes', '/api/admin/users', '/api/admin/audit-logs']) {
      const res = await fetch(`${baseUrl}${ep}`);
      assert.equal(res.status, 401, `${ep} powinien wymagać sesji`);
    }
    const anonSocket = await connectSocket(baseUrl);
    try {
      const res = await emitWithAck(anonSocket, 'host_create_room', {
        quizId: 'default-cyber-quiz',
      });
      assert.equal(res.error, 'UNAUTHORIZED');
    } finally {
      anonSocket.disconnect();
    }
  });

  // 4. Logowanie superadmina + obowiązkowy enrollment MFA (FIDO2 PIN) + wielokluczowość + testy negatywne
  const superClient = new AuthClient(baseUrl);
  const yubiKey1 = new VirtualFido2Key({ transports: ['usb', 'nfc'], initialCounter: 5 });
  const touchIdKey2 = new VirtualFido2Key({ transports: ['internal'], initialCounter: 0 });
  const createdCredIds = [];

  await step('Logowanie superadmina + wymuszony enrollment MFA (UV=1) + ochrona sesji pre-MFA i CSRF', async () => {
    const bad = await superClient.login(superadminUser, 'WrongPassword_123456!');
    assert.equal(bad.res.status, 401);
    assert.equal(bad.data.error, 'INVALID_CREDENTIALS');

    const ok = await superClient.login(superadminUser, superadminPass);
    assert.equal(ok.res.status, 200);
    assert.equal(ok.data.user.role, 'superadmin');
    assert.equal(ok.res.headers.get('cache-control'), 'no-store');
    assert.match(superClient.lastRawSetCookie, /HttpOnly/i);
    assert.match(superClient.lastRawSetCookie, /SameSite=Lax/i);
    assert.ok(superClient.csrfToken);

    // W domyślnym trybie required bez kluczy -> MFA_ENROLLMENT_REQUIRED
    assert.equal(
      ok.data.status,
      'MFA_ENROLLMENT_REQUIRED',
      'Nowy superadmin bez kluczy musi przejść obowiązkowy enrollment MFA'
    );

    // Sesja pre-MFA nie ma dostępu do REST API ani Socket.IO
    const preMfaQuiz = await superClient.request('/api/quizzes');
    assert.equal(preMfaQuiz.res.status, 403);
    assert.equal(preMfaQuiz.data.error, 'MFA_ENROLLMENT_REQUIRED');

    const preMfaUsers = await superClient.request('/api/admin/users');
    assert.equal(preMfaUsers.res.status, 403);

    const preMfaSocket = await connectSocket(baseUrl, superClient.cookie);
    try {
      const sockRes = await emitWithAck(preMfaSocket, 'host_create_room', {
        quizId: 'default-cyber-quiz',
      });
      assert.equal(sockRes.error, 'UNAUTHORIZED');
    } finally {
      preMfaSocket.disconnect();
    }

    // Rejestracja BEZ flagi UV (brak PIN-u FIDO2) musi zostać odrzucona
    const regOptBad = await superClient.request('/api/auth/mfa/register/options', {
      method: 'POST',
      body: {},
    });
    assert.equal(regOptBad.res.status, 200);
    assert.equal(
      regOptBad.data.options.authenticatorSelection.userVerification,
      'required'
    );
    assert.equal(
      regOptBad.data.options.authenticatorSelection.authenticatorAttachment,
      undefined,
      'Brak ograniczenia authenticatorAttachment (YubiKey + inne klucze + Touch ID)'
    );

    const attNoUv = yubiKey1.createRegistrationResponse(regOptBad.data.options, {
      origin: webauthnOrigin,
      uv: false,
    });
    const regFailUv = await superClient.request('/api/auth/mfa/register/verify', {
      method: 'POST',
      body: { name: 'Bez PIN', response: attNoUv },
    });
    assert.equal(regFailUv.res.status, 400);

    // Poprawna rejestracja 1. klucza (YubiKey z UV=1) kończy enrollment i rotuje sesję
    const preEnrollCookie = superClient.cookie;
    const regOpt1 = await superClient.request('/api/auth/mfa/register/options', {
      method: 'POST',
      body: {},
    });
    assert.equal(regOpt1.res.status, 200);
    const att1 = yubiKey1.createRegistrationResponse(regOpt1.data.options, {
      origin: webauthnOrigin,
      uv: true,
    });
    const regOk1 = await superClient.request('/api/auth/mfa/register/verify', {
      method: 'POST',
      body: { name: 'YubiKey 5C Smoke', response: att1 },
    });
    assert.equal(regOk1.res.status, 201);
    assert.equal(regOk1.data.status, 'AUTHENTICATED');
    assert.notEqual(superClient.cookie, preEnrollCookie, 'Sesja musi ulec rotacji po enrollment');
    assert.ok(regOk1.data.credential?.id);
    createdCredIds.push(regOk1.data.credential.id);

    // Stare ciasteczko pre-MFA przestaje działać
    const staleRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: preEnrollCookie },
    });
    assert.equal(staleRes.status, 401);

    // Anti-lockout: nie można usunąć ostatniego klucza w trybie required
    const delLast = await superClient.request(
      `/api/auth/mfa/credentials/${regOk1.data.credential.id}`,
      {
        method: 'DELETE',
        body: { currentPassword: superadminPass },
      }
    );
    assert.equal(delLast.res.status, 409);
    assert.equal(delLast.data.error, 'LAST_MFA_KEY_PROTECTED');

    // Dodanie 2. klucza (np. Touch ID) wymaga poprawnego aktualnego hasła (re-auth)
    const regOptNoPwd = await superClient.request('/api/auth/mfa/register/options', {
      method: 'POST',
      body: { currentPassword: 'WrongPassword_123456!' },
    });
    assert.equal(regOptNoPwd.res.status, 400);

    const regOpt2 = await superClient.request('/api/auth/mfa/register/options', {
      method: 'POST',
      body: { currentPassword: superadminPass },
    });
    assert.equal(regOpt2.res.status, 200);
    const att2 = touchIdKey2.createRegistrationResponse(regOpt2.data.options, {
      origin: webauthnOrigin,
      uv: true,
    });
    const regOk2 = await superClient.request('/api/auth/mfa/register/verify', {
      method: 'POST',
      body: { name: 'Touch ID Smoke', response: att2 },
    });
    assert.equal(regOk2.res.status, 201);
    assert.equal(regOk2.data.mfaCredentialsCount, 2);
    createdCredIds.push(regOk2.data.credential.id);

    // Zmiana nazwy 2. klucza
    const renamed = await superClient.request(
      `/api/auth/mfa/credentials/${regOk2.data.credential.id}`,
      {
        method: 'PATCH',
        body: { name: 'MacBook Touch ID' },
      }
    );
    assert.equal(renamed.res.status, 200);
    assert.equal(renamed.data.credential.name, 'MacBook Touch ID');

    // Mutacja bez CSRF tokena -> 403
    const noCsrf = await superClient.request('/api/quizzes', {
      method: 'POST',
      csrf: false,
      body: { title: 'No CSRF', mode: 'quiz', questions: [] },
    });
    assert.equal(noCsrf.res.status, 403);
    assert.equal(noCsrf.data.error, 'INVALID_CSRF_TOKEN');
  });

  await step('MFA krok 2 (YubiKey + Touch ID), testy negatywne (UV=0, replay, zły origin, counter anomaly)', async () => {
    // Logowanie z istniejącymi kluczami -> MFA_REQUIRED
    const mfaClient = new AuthClient(baseUrl);
    const step1 = await mfaClient.login(superadminUser, superadminPass);
    assert.equal(step1.res.status, 200);
    assert.equal(step1.data.status, 'MFA_REQUIRED');

    const blockedPre = await mfaClient.request('/api/quizzes');
    assert.equal(blockedPre.res.status, 403);
    assert.equal(blockedPre.data.error, 'MFA_REQUIRED');

    // Test negatywny 1: brak UV (UV=0) -> 401
    const optNoUv = await mfaClient.request('/api/auth/mfa/login/options', {
      method: 'POST',
    });
    assert.equal(optNoUv.res.status, 200);
    assert.equal(optNoUv.data.options.userVerification, 'required');
    const respNoUv = yubiKey1.createAuthenticationResponse(optNoUv.data.options, {
      origin: webauthnOrigin,
      uv: false,
    });
    const failNoUv = await mfaClient.request('/api/auth/mfa/login/verify', {
      method: 'POST',
      body: { response: respNoUv },
    });
    assert.equal(failNoUv.res.status, 401);

    // Test negatywny 2: zły origin (phishing) -> 401
    const optPhish = await mfaClient.request('/api/auth/mfa/login/options', {
      method: 'POST',
    });
    const respPhish = yubiKey1.createAuthenticationResponse(optPhish.data.options, {
      origin: 'https://evil-phishing.example',
      uv: true,
    });
    const failPhish = await mfaClient.request('/api/auth/mfa/login/verify', {
      method: 'POST',
      body: { response: respPhish },
    });
    assert.equal(failPhish.res.status, 401);

    // Test negatywny 3: regresja licznika (klonowany klucz: counter <= 5) -> 401 + AUTH_MFA_COUNTER_ANOMALY
    const optClone = await mfaClient.request('/api/auth/mfa/login/options', {
      method: 'POST',
    });
    const respClone = yubiKey1.createAuthenticationResponse(optClone.data.options, {
      origin: webauthnOrigin,
      uv: true,
      counterOverride: 3,
    });
    const failClone = await mfaClient.request('/api/auth/mfa/login/verify', {
      method: 'POST',
      body: { response: respClone },
    });
    assert.equal(failClone.res.status, 401);
    assert.equal(failClone.data.error, 'MFA_COUNTER_ANOMALY');

    // Poprawne logowanie 1. kluczem (YubiKey, UV=1, counter > 5) + test replay
    const preMfaCookie = mfaClient.cookie;
    const optOk = await mfaClient.request('/api/auth/mfa/login/options', {
      method: 'POST',
    });
    const respOk = yubiKey1.createAuthenticationResponse(optOk.data.options, {
      origin: webauthnOrigin,
      uv: true,
      counterOverride: 10,
    });
    yubiKey1.counter = 10;

    const verOk = await mfaClient.request('/api/auth/mfa/login/verify', {
      method: 'POST',
      body: { response: respOk },
    });
    assert.equal(verOk.res.status, 200);
    assert.equal(verOk.data.status, 'AUTHENTICATED');
    assert.notEqual(mfaClient.cookie, preMfaCookie);

    // Replay: próba ponownego użycia tej samej odpowiedzi WebAuthn z nową sesją pre-MFA
    const replayClient = new AuthClient(baseUrl);
    await replayClient.login(superadminUser, superadminPass);
    await replayClient.request('/api/auth/mfa/login/options', { method: 'POST' });
    const replayRes = await replayClient.request('/api/auth/mfa/login/verify', {
      method: 'POST',
      body: { response: respOk },
    });
    assert.equal(replayRes.res.status, 401);

    // Poprawne logowanie 2. kluczem (Touch ID, counter=0 -> 0 dozwolone wg specyfikacji WebAuthn)
    const optTouch = await replayClient.request('/api/auth/mfa/login/options', {
      method: 'POST',
    });
    const respTouch = touchIdKey2.createAuthenticationResponse(
      optTouch.data.options,
      { origin: webauthnOrigin, uv: true, counterOverride: 0 }
    );
    const verTouch = await replayClient.request('/api/auth/mfa/login/verify', {
      method: 'POST',
      body: { response: respTouch },
    });
    assert.equal(verTouch.res.status, 200);
    assert.equal(verTouch.data.status, 'AUTHENTICATED');

    // Weryfikacja wpisu AUTH_MFA_COUNTER_ANOMALY w audit_logs
    const mfaLogs = await superClient.request(
      '/api/admin/audit-logs?eventType=AUTH_MFA_COUNTER_ANOMALY'
    );
    assert.equal(mfaLogs.res.status, 200);
    assert.ok(mfaLogs.data.items.length >= 1, 'Brak wpisu AUTH_MFA_COUNTER_ANOMALY');

    // Usunięcie 2. klucza (zostaje 1. klucz) działa z poprawnym hasłem
    const delSecond = await superClient.request(
      `/api/auth/mfa/credentials/${createdCredIds[1]}`,
      {
        method: 'DELETE',
        body: { currentPassword: superadminPass },
      }
    );
    assert.equal(delSecond.res.status, 200);
    assert.equal(delSecond.data.remainingCredentials, 1);

    // Zamykamy sesję pomocniczą
    await mfaClient.request('/api/auth/logout', { method: 'POST' });
    await replayClient.request('/api/auth/logout', { method: 'POST' });
  });

  // 5. Inwariant pojedynczego superadmina + tworzenie 2 kont adminów i wymuszona zmiana hasła
  const tag = Date.now().toString(36).slice(-5);
  const adminAUser = `smoke_a_${tag}`;
  const adminBUser = `smoke_b_${tag}`;
  const adminAPass = 'StrongAdminA_Passphrase_2026!';
  const adminBPass = 'StrongAdminB_Passphrase_2026!';
  let adminAId = null;
  let adminBId = null;
  const adminAClient = new AuthClient(baseUrl);
  const adminBClient = new AuthClient(baseUrl);

  try {
    await step('Inwariant 1 superadmina + tworzenie adminów + wymuszona zmiana hasła', async () => {
      // Blokada utworzenia 2. superadmina przez API
      const forbiddenRole = await superClient.request('/api/admin/users', {
        method: 'POST',
        body: { username: `fake_super_${tag}`, role: 'superadmin' },
      });
      assert.equal(forbiddenRole.res.status, 403);
      assert.equal(forbiddenRole.data.error, 'SUPERADMIN_ROLE_FORBIDDEN');

      // Utworzenie 2 adminów
      const createdA = await superClient.request('/api/admin/users', {
        method: 'POST',
        body: { username: adminAUser },
      });
      assert.equal(createdA.res.status, 201);
      assert.equal(createdA.data.user.role, 'admin');
      assert.ok(createdA.data.temporaryPassword?.length >= 12);
      adminAId = createdA.data.user.id;

      const createdB = await superClient.request('/api/admin/users', {
        method: 'POST',
        body: { username: adminBUser },
      });
      assert.equal(createdB.res.status, 201);
      adminBId = createdB.data.user.id;

      // Pierwsze logowanie Admin A -> MUST_CHANGE_PASSWORD blokuje dostęp do quizów
      const loginA = await adminAClient.login(
        adminAUser,
        createdA.data.temporaryPassword
      );
      assert.equal(loginA.res.status, 200);
      assert.equal(loginA.data.status, 'MUST_CHANGE_PASSWORD');

      const blockedQuiz = await adminAClient.request('/api/quizzes');
      assert.equal(blockedQuiz.res.status, 403);
      assert.equal(blockedQuiz.data.error, 'MUST_CHANGE_PASSWORD');

      // Słabe hasło (<12 znaków) zostaje odrzucone
      const weakPwd = await adminAClient.request('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: createdA.data.temporaryPassword,
          newPassword: 'short',
        },
      });
      assert.equal(weakPwd.res.status, 400);

      // Silne hasło odblokowuje dostęp i rotuje sesję
      const oldCookieA = adminAClient.cookie;
      const changedA = await adminAClient.request('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: createdA.data.temporaryPassword,
          newPassword: adminAPass,
        },
      });
      assert.equal(changedA.res.status, 200);
      assert.equal(changedA.data.status, 'AUTHENTICATED');
      assert.notEqual(adminAClient.cookie, oldCookieA, 'ID sesji musi ulec rotacji');

      // Zwykły admin nie ma dostępu do /api/admin/users ani /api/auth/mfa/credentials
      const adminDenied = await adminAClient.request('/api/admin/users');
      assert.equal(adminDenied.res.status, 403);
      const adminMfaDenied = await adminAClient.request('/api/auth/mfa/credentials');
      assert.equal(adminMfaDenied.res.status, 403);

      // Logowanie i zmiana hasła dla Admin B
      const loginB = await adminBClient.login(
        adminBUser,
        createdB.data.temporaryPassword
      );
      assert.equal(loginB.res.status, 200);
      const changedB = await adminBClient.request('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: createdB.data.temporaryPassword,
          newPassword: adminBPass,
        },
      });
      assert.equal(changedB.res.status, 200);
    });

    // 6. CRUD quizów, szablony read-only, klonowanie oraz ścisła izolacja między adminami
    await step('Izolacja quizów między adminami (BOLA/IDOR) + szablony + CRUD 5 typów pytań', async () => {
      // Admin A widzi szablony jako read-only
      const listA = await adminAClient.request('/api/quizzes');
      assert.equal(listA.res.status, 200);
      const defaultTpl = listA.data.find((q) => q.id === 'default-cyber-quiz');
      assert.ok(defaultTpl && defaultTpl.isTemplate === true && defaultTpl.canEdit === false);

      // Admin A nie może edytować szablonu
      const editTpl = await adminAClient.request('/api/quizzes/default-cyber-quiz', {
        method: 'PUT',
        body: {
          title: 'Zhakowany szablon',
          mode: 'quiz',
          questions: [
            {
              type: 'abcd',
              content: 'Test?',
              timeLimit: 15,
              answers: ['A', 'B'],
              correctIndex: 0,
            },
          ],
        },
      });
      assert.equal(editTpl.res.status, 403);
      assert.equal(editTpl.data.error, 'TEMPLATE_READ_ONLY');

      // Klonowanie szablonu działa i tworzy własny edytowalny quiz
      const cloned = await adminAClient.request('/api/quizzes/default-cyber-quiz/clone', {
        method: 'POST',
      });
      assert.equal(cloned.res.status, 201);
      assert.equal(cloned.data.isTemplate, false);
      assert.equal(cloned.data.canEdit, true);

      // Tworzenie pełnego quizu mixed (5 typów pytań)
      const createPayload = {
        title: 'CI Smoke Test — Mixed',
        mode: 'mixed',
        questions: [
          {
            type: 'abcd',
            content: 'Port HTTPS?',
            timeLimit: 15,
            answers: ['80', '443', '22', '53'],
            correctIndex: 1,
          },
          {
            type: 'true_false',
            content: 'TLS szyfruje ruch sieciowy.',
            timeLimit: 15,
            answers: ['Prawda', 'Fałsz'],
            correctIndex: 0,
          },
          {
            type: 'slider',
            content: 'Rok publikacji TLS 1.3?',
            timeLimit: 20,
            sliderMin: 2010,
            sliderMax: 2025,
            sliderStep: 1,
            sliderCorrect: 2018,
            sliderTolerance: 1,
            scored: true,
          },
          {
            type: 'poll',
            content: 'Ulubiony system?',
            timeLimit: 15,
            answers: ['Linux', 'macOS', 'Windows'],
          },
          {
            type: 'word_cloud',
            content: 'Jedno słowo o bezpieczeństwie',
            timeLimit: 20,
            maxLength: 32,
          },
        ],
      };

      const created = await adminAClient.request('/api/quizzes', {
        method: 'POST',
        body: createPayload,
      });
      assert.equal(created.res.status, 201);
      const quizAId = created.data.id;

      // IZOLACJA: Admin B nie widzi, nie może edytować ani usunąć quizu Admina A
      const listB = await adminBClient.request('/api/quizzes');
      assert.equal(
        listB.data.some((q) => q.id === quizAId),
        false,
        'Admin B nie może widzieć prywatnego quizu Admina A'
      );
      const getB = await adminBClient.request(`/api/quizzes/${quizAId}`);
      assert.equal(getB.res.status, 404);
      const putB = await adminBClient.request(`/api/quizzes/${quizAId}`, {
        method: 'PUT',
        body: { ...createPayload, title: 'Przejęty quiz' },
      });
      assert.equal(putB.res.status, 404);
      const delB = await adminBClient.request(`/api/quizzes/${quizAId}`, {
        method: 'DELETE',
      });
      assert.equal(delB.res.status, 404);

      // Admin A aktualizuje i usuwa swój quiz
      const updated = await adminAClient.request(`/api/quizzes/${quizAId}`, {
        method: 'PUT',
        body: { ...createPayload, title: 'CI Smoke Test — Updated' },
      });
      assert.equal(updated.res.status, 200);
      assert.equal(updated.data.title, 'CI Smoke Test — Updated');

      const deleted = await adminAClient.request(`/api/quizzes/${quizAId}`, {
        method: 'DELETE',
      });
      assert.equal(deleted.res.status, 200);
    });

    // 7. E2E Socket.IO: autoryzowany host, izolacja pokoju, publiczny ekran i gracze
    await step('E2E Socket.IO: uwierzytelniony host + izolacja pokoju + publiczni gracze i rzutnik', async () => {
      const quizRes = await adminAClient.request('/api/quizzes', {
        method: 'POST',
        body: {
          title: 'CI E2E 1Q',
          mode: 'quiz',
          questions: [
            {
              type: 'abcd',
              content: 'Która odpowiedź jest poprawna?',
              timeLimit: 15,
              answers: ['A', 'B', 'C', 'D'],
              correctIndex: 1,
            },
          ],
        },
      });
      assert.equal(quizRes.res.status, 201);
      const testQuiz = quizRes.data;

      const sockets = [];
      try {
        const hostA = await connectSocket(baseUrl, adminAClient.cookie);
        const hostB = await connectSocket(baseUrl, adminBClient.cookie);
        const screen = await connectSocket(baseUrl); // publiczny (bez cookie)
        const player1 = await connectSocket(baseUrl); // publiczny (bez cookie)
        const player2 = await connectSocket(baseUrl);
        const duplicatePlayer = await connectSocket(baseUrl);
        sockets.push(hostA, hostB, screen, player1, player2, duplicatePlayer);

        // Host B nie może uruchomić pokoju z prywatnym quizem Host A
        const hijackCreate = await emitWithAck(hostB, 'host_create_room', {
          quizId: testQuiz.id,
        });
        assert.equal(hijackCreate.error, 'QUIZ_NOT_FOUND');

        // Host A tworzy pokój
        const room = await emitWithAck(hostA, 'host_create_room', {
          quizId: testQuiz.id,
        });
        assert.ok(room.pin && /^\d{6}$/.test(room.pin));
        const { pin } = room;

        // Host B nie może sterować pokojem Host A (FORBIDDEN)
        const hijackStart = await emitWithAck(hostB, 'host_start_game', { pin });
        assert.equal(hijackStart.error, 'FORBIDDEN');

        // Publiczny ekran i gracze dołączają bez logowania
        const snapshot = await emitWithAck(screen, 'screen_join_room', { pin });
        assert.equal(snapshot.error, undefined);
        assert.equal(snapshot.status, 'LOBBY');

        const join1 = await emitWithAck(player1, 'player_join', {
          pin,
          nickname: 'ALICE',
        });
        assert.equal(join1.success, true);

        const joinDup = await emitWithAck(duplicatePlayer, 'player_join', {
          pin,
          nickname: 'alice',
        });
        assert.equal(joinDup.error, 'NICKNAME_TAKEN');

        const join2 = await emitWithAck(player2, 'player_join', {
          pin,
          nickname: 'BOB',
        });
        assert.equal(join2.success, true);

        // Start -> preview -> question
        const p1Countdown = waitForEvent(player1, 'player_countdown');
        hostA.emit('host_start_game', { pin });
        await p1Countdown;

        const p1Preview = waitForEvent(player1, 'player_question_preview');
        hostA.emit('host_force_next', { pin });
        await p1Preview;

        const p1Start = waitForEvent(player1, 'player_question_start');
        const p2Start = waitForEvent(player2, 'player_question_start');
        hostA.emit('host_force_next', { pin });
        await Promise.all([p1Start, p2Start]);

        const p1Locked = waitForEvent(player1, 'answer_locked');
        const p2Locked = waitForEvent(player2, 'answer_locked');
        const p1End = waitForEvent(player1, 'player_question_end');
        const p2End = waitForEvent(player2, 'player_question_end');

        player1.emit('submit_answer', { pin, qIndex: 0, answerIndex: 1 });
        player2.emit('submit_answer', { pin, qIndex: 0, answerIndex: 0 });

        await Promise.all([p1Locked, p2Locked]);
        const [end1, end2] = await Promise.all([p1End, p2End]);
        assert.equal(end1.isCorrect, true);
        assert.ok(end1.earnedPoints >= 500);
        assert.equal(end2.isCorrect, false);
        assert.equal(end2.earnedPoints, 0);

        const p1Podium = waitForEvent(player1, 'player_podium');
        const p2Podium = waitForEvent(player2, 'player_podium');
        hostA.emit('host_force_next', { pin });
        const [pod1, pod2] = await Promise.all([p1Podium, p2Podium]);
        assert.equal(pod1.rank, 1);
        assert.equal(pod2.rank, 2);

        await emitWithAck(hostA, 'host_leave_room', { pin });
      } finally {
        for (const s of sockets) s.disconnect();
      }
    });

    // 8. Natychmiastowe unieważnienie sesji przy dezaktywacji + logi audytowe
    await step('Dezaktywacja admina natychmiast odcina sesję + wpis w audit_logs', async () => {
      const deact = await superClient.request(
        `/api/admin/users/${adminAId}/status`,
        {
          method: 'PATCH',
          body: { isActive: false },
        }
      );
      assert.equal(deact.res.status, 200);
      assert.ok(deact.data.revokedSessions >= 1);

      const afterDeact = await adminAClient.request('/api/quizzes');
      assert.equal(afterDeact.res.status, 401);

      const logs = await superClient.request('/api/admin/audit-logs?limit=25');
      assert.equal(logs.res.status, 200);
      assert.ok(
        logs.data.items.some((e) => e.eventType === 'ADMIN_DEACTIVATED'),
        'Brak wpisu ADMIN_DEACTIVATED w logach audytowych'
      );
    });
  } finally {
    // Sprzątanie kont testowych
    for (const id of [adminAId, adminBId]) {
      if (id) {
        await superClient
          .request(`/api/admin/users/${id}`, { method: 'DELETE' })
          .catch(() => {});
      }
    }
  }

  if (createdTempSuperadmin) {
    await step('Awaryjne CLI reset-superadmin.mjs --list-mfa oraz --reset-mfa', async () => {
      const resetScript = path.join(
        ROOT_DIR,
        'server',
        'scripts',
        'reset-superadmin.mjs'
      );
      const listOut = execFileSync(process.execPath, [resetScript, '--list-mfa'], {
        cwd: path.join(ROOT_DIR, 'server'),
        encoding: 'utf8',
      });
      assert.match(listOut, /YubiKey 5C Smoke/);

      const resetOut = execFileSync(process.execPath, [resetScript, '--reset-mfa'], {
        cwd: path.join(ROOT_DIR, 'server'),
        encoding: 'utf8',
      });
      assert.match(resetOut, /usunięto kluczy MFA: 1/);

      // Stara sesja superadmina musi być unieważniona
      const afterReset = await superClient.request('/api/auth/me');
      assert.equal(afterReset.res.status, 401);

      // Ponowne logowanie znów wymusza enrollment MFA
      const relogin = await superClient.login(superadminUser, superadminPass);
      assert.equal(relogin.res.status, 200);
      assert.equal(relogin.data.status, 'MFA_ENROLLMENT_REQUIRED');
    });
  }

  console.log(`\nWszystkie testy (${passed}/${passed}) zakończone sukcesem.\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let serverProc = null;
  let baseUrl = opts.url;
  let createdTempSuperadmin = false;

  try {
    if (!baseUrl) {
      createdTempSuperadmin = ensureSuperadminBootstrapped(
        opts.superadminUser,
        opts.superadminPass
      );
      const started = await startServer(opts.port);
      serverProc = started.child;
      baseUrl = started.baseUrl;
    }
    await runTests(baseUrl, { ...opts, createdTempSuperadmin });
  } finally {
    await stopServer(serverProc);
    if (createdTempSuperadmin) {
      await cleanupBootstrappedSuperadmin(opts.superadminUser).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error('\n[FAIL]', err);
  process.exit(1);
});
