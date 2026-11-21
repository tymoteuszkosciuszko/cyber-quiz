#!/usr/bin/env node
/**
 * Automatyczne testy dymne i E2E (REST API + SPA + Socket.IO + Redis)
 * dla aplikacji Cyber Quiz.
 *
 * Użycie:
 *   node scripts/smoke-test.mjs                 # sam uruchamia serwer na wolnym porcie
 *   node scripts/smoke-test.mjs --url http://127.0.0.1:3001
 *   node scripts/smoke-test.mjs --skip-static   # pomija sprawdzenie client/dist
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      opts.url = argv[++i].replace(/\/$/, '');
    } else if (arg === '--port' && argv[i + 1]) {
      opts.port = Number(argv[++i]);
    } else if (arg === '--skip-static') {
      opts.skipStatic = true;
    }
  }
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForEvent(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timeout (${timeoutMs}ms) podczas oczekiwania na zdarzenie "${event}"`));
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

async function connectSocket(baseUrl) {
  const socket = io(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout połączenia WebSocket')), 6000);
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
  throw new Error(`Serwer nie odpowiedział na /health w ciągu 15s.\n${logs.join('')}`);
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

async function runTests(baseUrl, { skipStatic }) {
  let passed = 0;

  const step = async (name, fn) => {
    const start = Date.now();
    await fn();
    passed++;
    console.log(`  [OK] ${name} (${Date.now() - start}ms)`);
  };

  console.log(`\nUruchamianie testów Cyber Quiz przeciwko ${baseUrl}...\n`);

  // 1. Healthcheck
  await step('GET /health zwraca 200 i status Redis=ready', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.redis, 'ready');
  });

  // 2. Serwowanie zbudowanego SPA
  const distIndex = path.join(ROOT_DIR, 'client', 'dist', 'index.html');
  if (!skipStatic && fs.existsSync(distIndex)) {
    await step('Serwowanie statycznego SPA (/, /game-admin, /game-screen)', async () => {
      for (const route of ['/', '/game-admin', '/game-screen']) {
        const res = await fetch(`${baseUrl}${route}`);
        assert.equal(res.status, 200, `Ścieżka ${route} powinna zwrócić 200`);
        const html = await res.text();
        assert.match(html, /<!doctype html>/i, `Ścieżka ${route} powinna zwrócić HTML`);
        assert.match(html, /id="root"/, `Ścieżka ${route} powinna zawierać kontener #root`);
      }
    });
  } else {
    console.log('  [SKIP] Test statycznego SPA pominięty (brak client/dist lub flaga --skip-static)');
  }

  // 3. REST API CRUD + walidacja wszystkich 5 form pytań i trybów
  let createdQuizId = null;

  await step('GET /api/quizzes zwraca wbudowane zestawy startowe', async () => {
    const res = await fetch(`${baseUrl}/api/quizzes`);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list) && list.length >= 1, 'Lista quizów nie powinna być pusta');
    assert.ok(
      list.some((q) => q.id === 'default-cyber-quiz'),
      'Brak domyślnego quizu default-cyber-quiz'
    );
  });

  await step('POST /api/quizzes odrzuca nieprawidłowe dane (400)', async () => {
    const badRes1 = await fetch(`${baseUrl}/api/quizzes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', mode: 'quiz', questions: [] }),
    });
    assert.equal(badRes1.status, 400);

    // Chmura słów jest niedozwolona w trybie 'quiz'
    const badRes2 = await fetch(`${baseUrl}/api/quizzes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Błędny tryb',
        mode: 'quiz',
        questions: [{ type: 'word_cloud', content: 'Podaj hasło', timeLimit: 15 }],
      }),
    });
    assert.equal(badRes2.status, 400);
  });

  await step('POST/GET/PUT/DELETE /api/quizzes (tryb mixed, wszystkie 5 typów pytań)', async () => {
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

    const createRes = await fetch(`${baseUrl}/api/quizzes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.ok(created.id);
    assert.equal(created.mode, 'mixed');
    assert.equal(created.questions.length, 5);
    createdQuizId = created.id;

    // GET pojedynczego quizu
    const getRes = await fetch(`${baseUrl}/api/quizzes/${createdQuizId}`);
    assert.equal(getRes.status, 200);
    const fetched = await getRes.json();
    assert.equal(fetched.title, createPayload.title);

    // PUT aktualizacja
    const updateRes = await fetch(`${baseUrl}/api/quizzes/${createdQuizId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...createPayload,
        title: 'CI Smoke Test — Updated',
      }),
    });
    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.title, 'CI Smoke Test — Updated');

    // DELETE usunięcie
    const delRes = await fetch(`${baseUrl}/api/quizzes/${createdQuizId}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    createdQuizId = null;

    // GET po usunięciu -> 404
    const notFoundRes = await fetch(`${baseUrl}/api/quizzes/${created.id}`);
    assert.equal(notFoundRes.status, 404);
  });

  // 4. E2E rozgrywka WebSocket (Host + Ekran + 2 Graczy)
  await step('E2E Socket.IO: pokój, ekran, dołączanie, odpowiedź, punktacja, podium', async () => {
    // Tworzymy szybki 1-pytaniowy quiz do testu E2E
    const quizRes = await fetch(`${baseUrl}/api/quizzes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
    assert.equal(quizRes.status, 201);
    const testQuiz = await quizRes.json();

    const sockets = [];
    try {
      const host = await connectSocket(baseUrl);
      const screen = await connectSocket(baseUrl);
      const player1 = await connectSocket(baseUrl);
      const player2 = await connectSocket(baseUrl);
      const duplicatePlayer = await connectSocket(baseUrl);
      sockets.push(host, screen, player1, player2, duplicatePlayer);

      // Host tworzy pokój
      const room = await emitWithAck(host, 'host_create_room', { quizId: testQuiz.id });
      assert.ok(room.pin && /^\d{6}$/.test(room.pin), `Nieprawidłowy PIN: ${room.pin}`);
      const { pin } = room;

      // Ekran dołącza do pokoju
      const snapshot = await emitWithAck(screen, 'screen_join_room', { pin });
      assert.equal(snapshot.error, undefined);
      assert.equal(snapshot.status, 'LOBBY');

      // Gracze dołączają + sprawdzenie blokady duplikatu nicku
      const join1 = await emitWithAck(player1, 'player_join', { pin, nickname: 'ALICE' });
      assert.equal(join1.success, true);

      const joinDup = await emitWithAck(duplicatePlayer, 'player_join', {
        pin,
        nickname: 'alice',
      });
      assert.equal(joinDup.error, 'NICKNAME_TAKEN');

      const join2 = await emitWithAck(player2, 'player_join', { pin, nickname: 'BOB' });
      assert.equal(join2.success, true);

      // Start gry -> countdown -> pomijamy countdown -> podgląd -> pomijamy podgląd -> pytanie
      const p1Countdown = waitForEvent(player1, 'player_countdown');
      host.emit('host_start_game', { pin });
      await p1Countdown;

      const p1Preview = waitForEvent(player1, 'player_question_preview');
      host.emit('host_force_next', { pin });
      await p1Preview;

      const p1Start = waitForEvent(player1, 'player_question_start');
      const p2Start = waitForEvent(player2, 'player_question_start');
      host.emit('host_force_next', { pin });
      const [q1, q2] = await Promise.all([p1Start, p2Start]);
      assert.equal(q1.qIndex, 0);
      assert.equal(q2.qIndex, 0);

      // Gracz 1 odpowiada poprawnie (indeks 1), Gracz 2 błędnie (indeks 0)
      const p1Locked = waitForEvent(player1, 'answer_locked');
      const p2Locked = waitForEvent(player2, 'answer_locked');
      const p1End = waitForEvent(player1, 'player_question_end');
      const p2End = waitForEvent(player2, 'player_question_end');

      player1.emit('submit_answer', { pin, qIndex: 0, answerIndex: 1 });
      player2.emit('submit_answer', { pin, qIndex: 0, answerIndex: 0 });

      await Promise.all([p1Locked, p2Locked]);
      const [end1, end2] = await Promise.all([p1End, p2End]);

      assert.equal(end1.scored, true);
      assert.equal(end1.isCorrect, true);
      assert.ok(end1.earnedPoints >= 500, `Gracz 1 powinien zdobyć >= 500 pkt, otrzymano: ${end1.earnedPoints}`);
      assert.equal(end1.correctIndex, 1);
      assert.equal(end2.scored, true);
      assert.equal(end2.isCorrect, false);
      assert.equal(end2.earnedPoints, 0);

      // Przejście do podium
      const p1Podium = waitForEvent(player1, 'player_podium');
      const p2Podium = waitForEvent(player2, 'player_podium');
      host.emit('host_force_next', { pin });
      const [pod1, pod2] = await Promise.all([p1Podium, p2Podium]);

      assert.equal(pod1.rank, 1);
      assert.ok(pod1.score >= 500, `Gracz 1 powinien mieć >= 500 pkt, otrzymano: ${pod1.score}`);
      assert.equal(pod2.rank, 2);
      assert.equal(pod2.score, 0);

      await emitWithAck(host, 'host_leave_room', { pin });
    } finally {
      for (const s of sockets) s.disconnect();
      await fetch(`${baseUrl}/api/quizzes/${testQuiz.id}`, { method: 'DELETE' }).catch(() => {});
    }
  });

  console.log(`\nWszystkie testy (${passed}/${passed}) zakończone sukcesem.\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let serverProc = null;
  let baseUrl = opts.url;

  try {
    if (!baseUrl) {
      const started = await startServer(opts.port);
      serverProc = started.child;
      baseUrl = started.baseUrl;
    }
    await runTests(baseUrl, { skipStatic: opts.skipStatic });
  } finally {
    await stopServer(serverProc);
  }
}

main().catch((err) => {
  console.error('\n[FAIL]', err);
  process.exit(1);
});
