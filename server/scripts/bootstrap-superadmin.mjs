#!/usr/bin/env node
/**
 * Jednorazowy skrypt CLI do utworzenia jedynego konta superadmina.
 *
 * Użycie interaktywne (zalecane na produkcji):
 *   docker exec -it cyber-quiz node scripts/bootstrap-superadmin.mjs
 *
 * Użycie nieinteraktywne (np. CI / automatyzacja):
 *   SUPERADMIN_USERNAME=superadmin SUPERADMIN_PASSWORD='...' node scripts/bootstrap-superadmin.mjs
 */

import readline from 'node:readline';
import { createPool, initDatabase } from '../db/pool.js';
import { hashPassword } from '../auth/crypto.js';
import { validatePassword, validateUsername } from '../auth/passwordPolicy.js';
import { logAudit } from '../auth/audit.js';

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
  const pool = createPool();
  try {
    await initDatabase(pool);

    const existing = await pool.query(
      `SELECT id, username FROM users WHERE role = 'superadmin' LIMIT 1`
    );
    if (existing.rows.length > 0) {
      console.error(
        `[BŁĄD] Konto superadmina już istnieje (login: "${existing.rows[0].username}"). ` +
          `W systemie może istnieć wyłącznie jeden superadmin. Aby zresetować hasło, użyj scripts/reset-superadmin.mjs.`
      );
      process.exit(1);
    }

    let rawUsername = process.env.SUPERADMIN_USERNAME || '';
    let rawPassword = process.env.SUPERADMIN_PASSWORD || '';

    if (!rawUsername) {
      rawUsername = await ask('Podaj login superadmina (3-32 znaki, np. superadmin): ');
    }
    const usernameCheck = validateUsername(rawUsername);
    if (!usernameCheck.valid) {
      console.error(`[BŁĄD] ${usernameCheck.message}`);
      process.exit(1);
    }

    if (!rawPassword) {
      rawPassword = await ask('Podaj silne hasło (min. 12 znaków): ', {
        hidden: true,
      });
      const confirm = await ask('Powtórz hasło: ', { hidden: true });
      if (rawPassword !== confirm) {
        console.error('[BŁĄD] Hasła nie są identyczne.');
        process.exit(1);
      }
    }

    const pwdCheck = validatePassword(rawPassword, usernameCheck.username);
    if (!pwdCheck.valid) {
      console.error(`[BŁĄD] ${pwdCheck.message}`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(pwdCheck.normalized);

    const { rows } = await pool.query(
      `INSERT INTO users
         (username, username_normalized, role, password_hash, is_active, must_change_password)
       VALUES ($1, $2, 'superadmin', $3, TRUE, FALSE)
       RETURNING id, username, role, created_at`,
      [usernameCheck.username, usernameCheck.normalized, passwordHash]
    );

    const created = rows[0];
    await logAudit(pool, {
      actorId: created.id,
      actorName: created.username,
      eventType: 'SUPERADMIN_BOOTSTRAPPED',
      targetId: created.id,
      status: 'SUCCESS',
      metadata: { source: 'cli' },
    });

    console.log(
      `[OK] Utworzono jedyne konto superadmina: "${created.username}" (ID: ${created.id}).`
    );
  } catch (err) {
    if (err?.code === '23505') {
      console.error('[BŁĄD] Naruszenie ograniczenia unikalności (login lub superadmin już istnieje).');
    } else {
      console.error('[BŁĄD]', err.message);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

