#!/usr/bin/env node
/**
 * Awaryjny skrypt CLI do zarządzania jedynym kontem superadmina:
 * - zmiana loginu (nazwy użytkownika),
 * - reset hasła (oraz odblokowanie / aktywacja konta),
 * - podgląd i awaryjny reset kluczy MFA (WebAuthn / YubiKey),
 * - natychmiastowe unieważnienie wszystkich aktywnych sesji w Redisie.
 *
 * Użycie interaktywne:
 *   node server/scripts/reset-superadmin.mjs
 *   docker exec -it cyber-quiz node scripts/reset-superadmin.mjs
 *
 * Użycie z parametrami:
 *   node server/scripts/reset-superadmin.mjs --username nowy_login --keep-password
 *   node server/scripts/reset-superadmin.mjs --username nowy_login --password 'NoweSilneHaslo123!'
 *   node server/scripts/reset-superadmin.mjs --list-mfa
 *   node server/scripts/reset-superadmin.mjs --reset-mfa
 *   SUPERADMIN_USERNAME=nowy_login node server/scripts/reset-superadmin.mjs --keep-password
 */

import readline from 'node:readline';
import Redis from 'ioredis';
import { createPool, initDatabase } from '../db/pool.js';
import { hashPassword } from '../auth/crypto.js';
import { validatePassword, validateUsername } from '../auth/passwordPolicy.js';
import { revokeAllUserSessions } from '../auth/sessions.js';
import { logAudit } from '../auth/audit.js';

function printHelp() {
  console.log(`
Cyber Quiz — CLI zarządzania kontem superadmina (login, hasło, MFA WebAuthn)

Użycie:
  node server/scripts/reset-superadmin.mjs [opcje]

Opcje:
  -u, --username <login>    Nowa nazwa użytkownika (3-32 znaki: A-Z, 0-9, . _ -)
  -p, --password <hasło>    Nowe silne hasło (min. 12 znaków)
  --keep-password           Zmień tylko login, bez pytania o nowe hasło
  --list-mfa                Wyświetl listę zarejestrowanych kluczy MFA superadmina
  --reset-mfa               Awaryjnie usuń wszystkie klucze MFA (YubiKey/FIDO2) i wyloguj sesje
  -h, --help                Wyświetl pomoc

Zmienne środowiskowe (opcjonalne):
  SUPERADMIN_USERNAME       Nowa nazwa użytkownika
  SUPERADMIN_PASSWORD       Nowe hasło
`);
}

function parseArgs(argv) {
  const opts = {
    username: process.env.SUPERADMIN_USERNAME || '',
    password: process.env.SUPERADMIN_PASSWORD || '',
    keepPassword: false,
    listMfa: false,
    resetMfa: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--keep-password') {
      opts.keepPassword = true;
    } else if (arg === '--list-mfa') {
      opts.listMfa = true;
    } else if (arg === '--reset-mfa') {
      opts.resetMfa = true;
    } else if ((arg === '-u' || arg === '--username') && argv[i + 1]) {
      opts.username = argv[++i];
    } else if ((arg === '-p' || arg === '--password') && argv[i + 1]) {
      opts.password = argv[++i];
    } else {
      throw new Error(`Nieznany argument: ${arg}`);
    }
  }

  return opts;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });

    if (hidden && process.stdin.isTTY) {
      const origWrite = rl._writeToOutput;
      rl._writeToOutput = function writeHidden(str) {
        if (str.includes(question)) {
          origWrite.call(rl, question);
        } else if (str === '\r\n' || str === '\n' || str === '\r') {
          origWrite.call(rl, str);
        }
      };
    }

    rl.question(question, (answer) => {
      if (hidden && process.stdin.isTTY) {
        process.stdout.write('\n');
      }
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[BŁĄD] ${err.message}`);
    printHelp();
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const pool = createPool();
  const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    ...(process.env.REDIS_PASSWORD
      ? { password: process.env.REDIS_PASSWORD }
      : {}),
  });

  try {
    await initDatabase(pool);

    const { rows } = await pool.query(
      `SELECT id, username, username_normalized
       FROM users
       WHERE role = 'superadmin'
       LIMIT 1`
    );
    const superadmin = rows[0];
    if (!superadmin) {
      console.error(
        '[BŁĄD] Nie znaleziono konta superadmina. Uruchom najpierw scripts/bootstrap-superadmin.mjs.'
      );
      process.exit(1);
    }

    // Tryb podglądu kluczy MFA (--list-mfa)
    if (opts.listMfa && !opts.resetMfa && !opts.username && !opts.password) {
      const credsRes = await pool.query(
        `SELECT id, name, transports, device_type, backed_up, counter, created_at, last_used_at
         FROM webauthn_credentials
         WHERE user_id = $1
         ORDER BY created_at ASC`,
        [superadmin.id]
      );
      console.log(`Superadmin: "${superadmin.username}" (ID: ${superadmin.id})`);
      if (credsRes.rows.length === 0) {
        console.log('Brak zarejestrowanych kluczy MFA (WebAuthn).');
      } else {
        console.log(`Zarejestrowane klucze MFA (${credsRes.rows.length}):`);
        for (const c of credsRes.rows) {
          const transports = Array.isArray(c.transports) && c.transports.length > 0
            ? c.transports.join(',')
            : 'brak';
          console.log(
            `  - [${c.id}] "${c.name}" | typ: ${c.device_type} | transporty: ${transports} | licznik: ${c.counter} | dodano: ${c.created_at.toISOString()} | ostatnio: ${c.last_used_at ? c.last_used_at.toISOString() : 'nigdy'}`
          );
        }
      }
      process.exit(0);
    }

    const isInteractive = Boolean(process.stdin.isTTY);
    let requestedUsername = opts.username.trim();
    let requestedPassword = opts.password;
    const mfaOnlyReset = opts.resetMfa && !requestedUsername && !requestedPassword;

    if (isInteractive && !requestedUsername && !requestedPassword && !opts.resetMfa) {
      console.log(`Aktualny login superadmina: "${superadmin.username}"`);
      const enteredUser = await ask(
        `Nowy login (Enter, aby zachować "${superadmin.username}"): `
      );
      requestedUsername = enteredUser.trim();
    }

    // Walidacja nowego loginu (jeśli podano)
    let nextUsername = superadmin.username;
    let nextUsernameNormalized = superadmin.username_normalized;
    let usernameChanged = false;

    if (requestedUsername) {
      const usernameCheck = validateUsername(requestedUsername);
      if (!usernameCheck.valid) {
        console.error(`[BŁĄD] ${usernameCheck.message}`);
        process.exit(1);
      }

      if (usernameCheck.username !== superadmin.username) {
        // Sprawdź kolizję z innym kontem (case-insensitive)
        const conflict = await pool.query(
          `SELECT id FROM users WHERE username_normalized = $1 AND id <> $2 LIMIT 1`,
          [usernameCheck.normalized, superadmin.id]
        );
        if (conflict.rows.length > 0) {
          console.error(
            `[BŁĄD] Login "${usernameCheck.username}" jest już zajęty przez inne konto.`
          );
          process.exit(1);
        }

        nextUsername = usernameCheck.username;
        nextUsernameNormalized = usernameCheck.normalized;
        usernameChanged = true;
      }
    }

    // Opcjonalne pytanie o nowe hasło w trybie interaktywnym
    if (!mfaOnlyReset && !opts.keepPassword && !requestedPassword && isInteractive) {
      const promptMsg = usernameChanged
        ? 'Nowe silne hasło (min. 12 znaków; Enter, aby zachować dotychczasowe): '
        : 'Nowe silne hasło (min. 12 znaków): ';
      requestedPassword = await ask(promptMsg, { hidden: true });
      if (requestedPassword) {
        const confirm = await ask('Powtórz nowe hasło: ', { hidden: true });
        if (requestedPassword !== confirm) {
          console.error('[BŁĄD] Hasła nie są identyczne.');
          process.exit(1);
        }
      }
    }

    let passwordHash = null;
    const passwordChanged = Boolean(requestedPassword);
    const mfaReset = Boolean(opts.resetMfa);

    if (passwordChanged) {
      const pwdCheck = validatePassword(requestedPassword, nextUsername);
      if (!pwdCheck.valid) {
        console.error(`[BŁĄD] ${pwdCheck.message}`);
        process.exit(1);
      }
      passwordHash = await hashPassword(pwdCheck.normalized);
    }

    if (!usernameChanged && !passwordChanged && !mfaReset) {
      console.log('Nie wprowadzono żadnych zmian.');
      process.exit(0);
    }

    if (passwordChanged) {
      await pool.query(
        `UPDATE users
         SET username = $2,
             username_normalized = $3,
             password_hash = $4,
             is_active = TRUE,
             must_change_password = FALSE,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [superadmin.id, nextUsername, nextUsernameNormalized, passwordHash]
      );
    } else if (usernameChanged) {
      await pool.query(
        `UPDATE users
         SET username = $2,
             username_normalized = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [superadmin.id, nextUsername, nextUsernameNormalized]
      );
    }

    let removedMfaCount = 0;
    if (mfaReset) {
      const delRes = await pool.query(
        `DELETE FROM webauthn_credentials WHERE user_id = $1`,
        [superadmin.id]
      );
      removedMfaCount = delRes.rowCount || 0;
    }

    // Zawsze unieważniamy aktywne sesje (odświeżenie loginu/MFA w sesji i bezpieczeństwo)
    const revoked = await revokeAllUserSessions(redis, superadmin.id);

    if (usernameChanged || passwordChanged) {
      const eventType =
        usernameChanged && passwordChanged
          ? 'SUPERADMIN_CLI_RENAMED_AND_PASSWORD_RESET'
          : usernameChanged
            ? 'SUPERADMIN_CLI_RENAMED'
            : 'SUPERADMIN_CLI_PASSWORD_RESET';

      await logAudit(pool, {
        actorId: superadmin.id,
        actorName: nextUsername,
        eventType,
        targetId: superadmin.id,
        status: 'SUCCESS',
        metadata: {
          previousUsername: superadmin.username,
          newUsername: nextUsername,
          usernameChanged,
          passwordChanged,
          revokedSessions: revoked,
        },
      });
    }

    if (mfaReset) {
      await logAudit(pool, {
        actorId: superadmin.id,
        actorName: nextUsername,
        eventType: 'SUPERADMIN_CLI_MFA_RESET',
        targetId: superadmin.id,
        status: 'SUCCESS',
        metadata: {
          removedCredentials: removedMfaCount,
          revokedSessions: revoked,
        },
      });
    }

    const summaryParts = [];
    if (usernameChanged) {
      summaryParts.push(
        `zmieniono login z "${superadmin.username}" na "${nextUsername}"`
      );
    }
    if (passwordChanged) {
      summaryParts.push('zresetowano hasło');
    }
    if (mfaReset) {
      summaryParts.push(`usunięto kluczy MFA: ${removedMfaCount}`);
    }
    console.log(
      `[OK] Superadmin zaktualizowany (${summaryParts.join(', ')}). Unieważniono sesji: ${revoked}.`
    );
  } catch (err) {
    if (err?.code === '23505') {
      console.error('[BŁĄD] Podany login jest już zajęty przez inne konto.');
    } else {
      console.error('[BŁĄD]', err.message);
    }
    process.exit(1);
  } finally {
    await pool.end();
    await redis.quit().catch(() => redis.disconnect());
  }
}

main();
