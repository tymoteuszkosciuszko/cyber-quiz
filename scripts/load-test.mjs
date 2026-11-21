#!/usr/bin/env node
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

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
      'Błąd: nie znaleziono pakietu "socket.io-client". Uruchom "npm install" w katalogu client/.'
    );
    console.error(err.message);
    process.exit(1);
  }
}

const DEFAULT_WORD_CLOUD_POOL = [
  'Bezpieczeństwo',
  'Szyfrowanie',
  'Firewall',
  'Phishing',
  'Linux',
  'Hasła',
  'Zero Trust',
  'Backup',
  'VPN',
  'Pentesty',
  'Cloud',
  'Aktualizacje',
  'MFA',
  'SIEM',
  'SOC',
  'Ransomware',
  'Docker',
  'Kubernetes',
  'Privacy',
  'OWASP',
];

function printHelp() {
  console.log(`
Cyber Quiz — Skrypt testowania obciążenia (symulacja X graczy)
Obsługuje wszystkie tryby (quiz, opinie, mieszany) oraz 5 form pytań:
ABCD, Prawda/Fałsz, Slider, Ankieta, Chmura słów.

Użycie:
  node scripts/load-test.mjs --pin <PIN> --players <X> [opcje]
  node scripts/load-test.mjs <X> --pin <PIN> [opcje]
  node scripts/load-test.mjs --auto-host --players <X> [opcje]

Parametry:
  <X>, -n, --players <liczba>   Liczba symulowanych graczy (wymagane)
  -p, --pin <PIN>               6-cyfrowy PIN uruchomionej sesji w fazie LOBBY
  -u, --url <URL>               Adres serwera (domyślnie: http://localhost:3001)
  --min-delay <ms>              Min. czas reakcji gracza w ms (domyślnie: 200)
  --max-delay <ms>              Max. czas reakcji gracza w ms (domyślnie: 80% czasu pytania)
  --ramp-up <ms>                Czas rozłożenia dołączania graczy w ms (domyślnie: auto, 0 = naraz)
  --answer-rate <0..1>          Odsetek graczy odpowiadających na pytanie (domyślnie: 1)
  --prefix <tekst>              Prefiks nicku bota (domyślnie: BOT)
  --words <a,b,c>               Własna lista haseł dla pytań typu chmura słów (oddzielone przecinkiem)
  --transport <ws|polling|auto> Transport Socket.IO (domyślnie: ws)
  --auto-host                   Tryb autonomiczny: sam tworzy pokój, startuje grę i zamyka po zakończeniu
  --quiz <quizId>               ID zestawu dla --auto-host (np. default-cyber-quiz, demo-mixed-session, demo-opinion-session)
  -h, --help                    Wyświetla tę pomoc

Przykłady:
  node scripts/load-test.mjs --pin 482910 --players 200
  node scripts/load-test.mjs 250 -p 482910 --min-delay 100 --max-delay 3000 --ramp-up 2000
  node scripts/load-test.mjs --auto-host -n 200 --ramp-up 0
  node scripts/load-test.mjs --auto-host --quiz demo-mixed-session -n 50
  node scripts/load-test.mjs --auto-host --quiz demo-opinion-session -n 50
`);
}

function parseArgs(argv) {
  const opts = {
    players: null,
    pin: null,
    url: process.env.SERVER_URL || 'http://localhost:3001',
    minDelay: 200,
    maxDelay: null,
    rampUp: null,
    answerRate: 1,
    prefix: 'BOT',
    words: DEFAULT_WORD_CLOUD_POOL,
    transport: 'ws',
    autoHost: false,
    quizId: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--auto-host') {
      opts.autoHost = true;
      continue;
    }

    const next = argv[i + 1];
    if (arg === '-n' || arg === '--players' || arg === '--count') {
      opts.players = Number(next);
      i++;
    } else if (arg === '-p' || arg === '--pin') {
      opts.pin = String(next ?? '').trim();
      i++;
    } else if (arg === '-u' || arg === '--url') {
      opts.url = String(next ?? '').trim();
      i++;
    } else if (arg === '--min-delay') {
      opts.minDelay = Number(next);
      i++;
    } else if (arg === '--max-delay') {
      opts.maxDelay = Number(next);
      i++;
    } else if (arg === '--ramp-up') {
      opts.rampUp = Number(next);
      i++;
    } else if (arg === '--answer-rate') {
      opts.answerRate = Number(next);
      i++;
    } else if (arg === '--prefix') {
      opts.prefix = String(next ?? 'BOT').trim();
      i++;
    } else if (arg === '--words') {
      const parsed = String(next ?? '')
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean);
      if (parsed.length > 0) opts.words = parsed;
      i++;
    } else if (arg === '--transport') {
      opts.transport = String(next ?? 'ws').trim().toLowerCase();
      i++;
    } else if (arg === '--quiz') {
      opts.quizId = String(next ?? '').trim();
      i++;
    } else if (!arg.startsWith('-') && opts.players === null && /^\d+$/.test(arg)) {
      opts.players = Number(arg);
    } else {
      throw new Error(`Nieznany argument: ${arg}`);
    }
  }

  return opts;
}

function validateOpts(opts) {
  if (opts.help) return;

  if (!Number.isInteger(opts.players) || opts.players <= 0) {
    throw new Error('Podaj poprawną dodatnią liczbę graczy (--players <X> lub jako parametr).');
  }
  if (!opts.autoHost && (!opts.pin || !/^\d{4,8}$/.test(opts.pin))) {
    throw new Error('Podaj poprawny PIN uruchomionej sesji (--pin <PIN>) lub użyj --auto-host.');
  }
  if (!Number.isFinite(opts.minDelay) || opts.minDelay < 0) {
    throw new Error('--min-delay musi być liczbą >= 0.');
  }
  if (opts.maxDelay !== null && (!Number.isFinite(opts.maxDelay) || opts.maxDelay < opts.minDelay)) {
    throw new Error('--max-delay musi być >= --min-delay.');
  }
  if (opts.rampUp === null) {
    opts.rampUp = Math.min(3000, opts.players * 10);
  } else if (!Number.isFinite(opts.rampUp) || opts.rampUp < 0) {
    throw new Error('--ramp-up musi być liczbą >= 0.');
  }
  if (!Number.isFinite(opts.answerRate) || opts.answerRate < 0 || opts.answerRate > 1) {
    throw new Error('--answer-rate musi być liczbą z przedziału 0..1.');
  }
  if (!['ws', 'websocket', 'polling', 'auto'].includes(opts.transport)) {
    throw new Error('--transport musi mieć wartość: ws, polling lub auto.');
  }
}

function getTransports(mode) {
  if (mode === 'ws' || mode === 'websocket') return ['websocket'];
  if (mode === 'polling') return ['polling'];
  return ['polling', 'websocket'];
}

function buildNickname(prefix, runTag, index, totalPlayers) {
  const digits = Math.max(2, String(totalPlayers).length);
  const suffix = `_${runTag}_${String(index).padStart(digits, '0')}`;
  const cleanPrefix = (prefix || 'BOT').toUpperCase().replace(/\s+/g, '');
  const maxPrefixLen = Math.max(1, 16 - suffix.length);
  return `${cleanPrefix.slice(0, maxPrefixLen)}${suffix}`.slice(0, 16);
}

function calcStats(values) {
  if (!values.length) {
    return { count: 0, min: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const percentile = (p) => {
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  };
  return {
    count: sorted.length,
    min: sorted[0],
    avg: sum / sorted.length,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    max: sorted[sorted.length - 1],
  };
}

function fmtMs(ms) {
  return `${ms.toFixed(1)} ms`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickSliderValue(min, max, step) {
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
  const safeMax = Number.isFinite(Number(max)) ? Number(max) : 100;
  const safeStep = Number(step) > 0 ? Number(step) : 1;
  // Lekki rozkład dzwonowy (średnia dwóch losowań), aby histogram wyglądał realistycznie
  const u = (Math.random() + Math.random()) / 2;
  const raw = safeMin + u * (safeMax - safeMin);
  const snapped = safeMin + Math.round((raw - safeMin) / safeStep) * safeStep;
  const clamped = Math.min(safeMax, Math.max(safeMin, snapped));
  return Number(clamped.toFixed(6));
}

function pickWordCloudEntry(pool, maxLength = 32) {
  const list = Array.isArray(pool) && pool.length > 0 ? pool : DEFAULT_WORD_CLOUD_POOL;
  // Rozkład ważony (kwadrat losowej liczby faworyzuje pierwsze hasła, dając wyraźną chmurę słów)
  const idx = Math.min(list.length - 1, Math.floor(Math.pow(Math.random(), 1.6) * list.length));
  const baseWord = list[idx];
  // Czasem wylosuj inną wielkość liter, aby przetestować normalizację po stronie serwera
  const variant =
    Math.random() < 0.2 ? baseWord.toLowerCase() : baseWord;
  return variant.slice(0, Math.max(1, Number(maxLength) || 32));
}

function buildAnswerPayload(questionData, wordsPool) {
  const qType = questionData.questionType || 'abcd';
  if (qType === 'slider') {
    return {
      value: pickSliderValue(
        questionData.sliderMin,
        questionData.sliderMax,
        questionData.sliderStep
      ),
    };
  }
  if (qType === 'word_cloud') {
    return {
      text: pickWordCloudEntry(wordsPool, questionData.maxLength),
    };
  }
  const optionsCount = Math.max(
    1,
    Number(questionData.optionsCount) || (qType === 'true_false' ? 2 : 4)
  );
  return {
    answerIndex: Math.floor(Math.random() * optionsCount),
  };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    validateOpts(opts);
  } catch (err) {
    console.error(`Błąd parametrów: ${err.message}`);
    console.error('Użyj --help, aby zobaczyć instrukcję.');
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const transports = getTransports(opts.transport);
  const runTag = Math.random().toString(36).slice(2, 5).toUpperCase();
  const sockets = [];
  const joinLatencies = [];
  const allAnswerLatencies = [];
  const joinErrors = new Map();
  let joinedCount = 0;
  let activeConnected = 0;
  let connectErrors = 0;
  let disconnectCount = 0;
  let totalErrors = 0;
  let totalAnswersSent = 0;
  let totalAnswersLocked = 0;
  let totalAnswerRejects = 0;

  // Stan bieżącej rundy agregowany dla wszystkich graczy
  const rounds = new Map();
  let lastLoggedPhase = '';
  let countdownLogged = false;
  let podiumPrinted = false;
  let podiumFirstAt = null;
  let podiumFinalizeTimer = null;
  let detectedSessionMode = null;
  let detectedHasScored = true;
  const podiumResults = [];

  let hostSocket = null;
  let activePin = opts.pin;
  let isShuttingDown = false;

  function getRound(qIndex, totalQuestions = '?', questionType = null, scored = null) {
    if (!rounds.has(qIndex)) {
      rounds.set(qIndex, {
        qIndex,
        totalQuestions,
        questionType: questionType || 'abcd',
        scored: scored !== null ? scored : true,
        sent: 0,
        locked: 0,
        rejected: 0,
        correct: 0,
        submitted: 0,
        ended: 0,
        latencies: [],
        firstEndAt: null,
        lastEndAt: null,
        printed: false,
        flushTimer: null,
      });
    } else {
      const r = rounds.get(qIndex);
      if (totalQuestions !== '?') r.totalQuestions = totalQuestions;
      if (questionType) r.questionType = questionType;
      if (scored !== null) r.scored = scored;
    }
    return rounds.get(qIndex);
  }

  function printRoundSummary(round) {
    if (!round || round.printed) return;
    round.printed = true;
    clearTimeout(round.flushTimer);

    const stats = calcStats(round.latencies);
    const fanOutMs =
      round.firstEndAt !== null && round.lastEndAt !== null
        ? round.lastEndAt - round.firstEndAt
        : 0;

    let outcomeSegment;
    if (round.scored === false) {
      const subPct =
        round.ended > 0
          ? ((round.submitted / round.ended) * 100).toFixed(1)
          : '0.0';
      outcomeSegment = `Głosy: ${round.submitted} (${subPct}%)`;
    } else {
      const correctPct =
        round.ended > 0
          ? ((round.correct / round.ended) * 100).toFixed(1)
          : '0.0';
      outcomeSegment = `Poprawne: ${round.correct} (${correctPct}%)`;
    }

    console.log(
      `[PYTANIE ${round.qIndex + 1}/${round.totalQuestions} | ${round.questionType}${round.scored ? '' : '/opinia'}] ` +
        `Wysłane: ${round.sent}/${joinedCount} | ` +
        `Locked: ${round.locked} | Odrzucone: ${round.rejected} | ` +
        `${outcomeSegment} | ` +
        `ACK p50/p95/max: ${fmtMs(stats.p50)} / ${fmtMs(stats.p95)} / ${fmtMs(stats.max)} | ` +
        `Fan-out: ${fmtMs(fanOutMs)}`
    );
  }

  function flushAllPendingRounds() {
    for (const round of rounds.values()) {
      if (!round.printed && (round.sent > 0 || round.ended > 0)) {
        printRoundSummary(round);
      }
    }
  }

  function printFinalReport(reason = 'ZAKOŃCZONO') {
    if (podiumPrinted) return;
    podiumPrinted = true;
    clearTimeout(podiumFinalizeTimer);
    flushAllPendingRounds();

    const joinStats = calcStats(joinLatencies);
    const ansStats = calcStats(allAnswerLatencies);
    const podiumFanOut =
      podiumFirstAt !== null ? performance.now() - podiumFirstAt : 0;

    console.log('\n============================================================');
    console.log(`RAPORT TESTU OBCIĄŻENIOWEGO (${reason})`);
    console.log('============================================================');
    console.log(`Serwer:             ${opts.url} (transport: ${transports.join(',')})`);
    console.log(`PIN pokoju:         ${activePin}`);
    if (detectedSessionMode) {
      console.log(`Tryb sesji:         ${detectedSessionMode}`);
    }
    console.log(`Gracze docelowi:    ${opts.players}`);
    console.log(`Dołączono (LOBBY):  ${joinedCount}/${opts.players}`);
    console.log(`Błędy połączenia:   ${connectErrors}`);
    console.log(`Rozłączenia:        ${disconnectCount}`);
    console.log(`Błędy zdarzeń:      ${totalErrors} (odrzucone odpowiedzi: ${totalAnswerRejects})`);
    if (joinErrors.size > 0) {
      const errSummary = Array.from(joinErrors.entries())
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      console.log(`Błędy dołączania:   ${errSummary}`);
    }
    console.log('------------------------------------------------------------');
    console.log(
      `Latencja JOIN:      min=${fmtMs(joinStats.min)} avg=${fmtMs(joinStats.avg)} ` +
        `p50=${fmtMs(joinStats.p50)} p95=${fmtMs(joinStats.p95)} p99=${fmtMs(joinStats.p99)} max=${fmtMs(joinStats.max)}`
    );
    console.log(
      `Odpowiedzi:         wysłane=${totalAnswersSent}, potwierdzone=${totalAnswersLocked}`
    );
    console.log(
      `Latencja ANSWER:    min=${fmtMs(ansStats.min)} avg=${fmtMs(ansStats.avg)} ` +
        `p50=${fmtMs(ansStats.p50)} p95=${fmtMs(ansStats.p95)} p99=${fmtMs(ansStats.p99)} max=${fmtMs(ansStats.max)}`
    );
    if (podiumResults.length > 0) {
      console.log(
        `Fan-out KONIEC:     ${fmtMs(podiumFanOut)} (odebrano: ${podiumResults.length}/${joinedCount})`
      );
      if (detectedHasScored && detectedSessionMode !== 'opinion') {
        const top = [...podiumResults]
          .sort((a, b) => (a.rank ?? 999999) - (b.rank ?? 999999) || b.score - a.score)
          .slice(0, 5);
        console.log('Top 5 symulowanych graczy:');
        for (const p of top) {
          console.log(`  #${p.rank ?? '?'} ${p.nickname} — ${p.score} pkt`);
        }
      } else {
        console.log('Sesja niepunktowana (tryb opinii) — pominięto ranking punktowy.');
      }
    }
    console.log('============================================================\n');
  }

  function cleanupAndExit(code = 0, reason = 'ZAKOŃCZONO') {
    if (isShuttingDown) return;
    isShuttingDown = true;
    printFinalReport(reason);
    for (const s of sockets) {
      s.disconnect();
    }
    if (hostSocket) {
      if (hostSocket.connected && activePin) {
        const hostEvent =
          reason === 'PODIUM' || reason === 'PODIUM_TIMEOUT'
            ? 'host_leave_room'
            : 'host_abort_game';
        hostSocket.emit(hostEvent, { pin: activePin }, () => {
          hostSocket.disconnect();
          process.exit(code);
        });
        setTimeout(() => {
          hostSocket.disconnect();
          process.exit(code);
        }, 300);
        return;
      }
      hostSocket.disconnect();
    }
    process.exit(code);
  }

  process.on('SIGINT', () => {
    console.log('\nPrzerwano przez użytkownika (SIGINT)...');
    cleanupAndExit(0, 'PRZERWANO_SIGINT');
  });

  // Opcjonalny tryb --auto-host tworzy pokój i zarządza przebiegiem gry
  if (opts.autoHost) {
    console.log(`[HOST] Łączenie z ${opts.url} i tworzenie pokoju...`);
    hostSocket = io(opts.url, {
      transports,
      reconnection: false,
      timeout: 10000,
    });

    await new Promise((resolve, reject) => {
      hostSocket.on('connect_error', (err) => {
        reject(new Error(`Host nie mógł połączyć się z serwerem: ${err.message}`));
      });
      hostSocket.on('connect', () => {
        hostSocket.emit('host_create_room', { quizId: opts.quizId }, (res) => {
          if (res?.error) {
            reject(new Error(`Nie udało się utworzyć pokoju: ${res.error}`));
            return;
          }
          activePin = res.pin;
          detectedSessionMode = res.quiz?.mode || 'quiz';
          console.log(
            `[HOST] Utworzono pokój PIN=${activePin} (${res.quiz?.title}, tryb: ${detectedSessionMode}, pytań: ${res.quiz?.questions?.length})`
          );
          resolve();
        });
      });
    });
  }

  console.log(
    `[START] Uruchamianie ${opts.players} graczy -> ${opts.url} (PIN: ${activePin}, ramp-up: ${opts.rampUp} ms, transport: ${transports.join(',')})`
  );

  const joinStartAll = performance.now();
  const delayStep = opts.players > 1 ? opts.rampUp / opts.players : 0;

  const spawnPlayer = (index) =>
    new Promise((resolve) => {
      const nickname = buildNickname(opts.prefix, runTag, index + 1, opts.players);
      const socket = io(opts.url, {
        transports,
        reconnection: false,
        timeout: 15000,
      });
      sockets.push(socket);

      let settled = false;
      let pendingAnswerTimer = null;
      let pendingSubmitAt = null;
      let currentQIndex = null;
      let hasJoined = false;

      const clearAnswerTimer = () => {
        if (pendingAnswerTimer) {
          clearTimeout(pendingAnswerTimer);
          pendingAnswerTimer = null;
        }
      };

      const finishJoin = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.on('connect_error', (err) => {
        connectErrors++;
        joinErrors.set(err.message, (joinErrors.get(err.message) || 0) + 1);
        finishJoin();
      });

      socket.on('disconnect', () => {
        clearAnswerTimer();
        if (hasJoined) {
          activeConnected = Math.max(0, activeConnected - 1);
          if (!isShuttingDown && !podiumPrinted) {
            disconnectCount++;
          }
        }
        finishJoin();
      });

      socket.on('connect', () => {
        const t0 = performance.now();
        socket.emit('player_join', { pin: activePin, nickname }, (res) => {
          const dt = performance.now() - t0;
          if (res?.error) {
            joinErrors.set(res.error, (joinErrors.get(res.error) || 0) + 1);
            socket.disconnect();
            finishJoin();
            return;
          }
          hasJoined = true;
          joinedCount++;
          activeConnected++;
          joinLatencies.push(dt);
          finishJoin();
        });
      });

      socket.on('player_countdown', ({ seconds }) => {
        if (!countdownLogged) {
          countdownLogged = true;
          console.log(`[FAZA] Odliczanie startowe (${seconds}s)...`);
        }
      });

      socket.on(
        'player_question_preview',
        ({ qIndex, totalQuestions, previewDuration, questionType = 'abcd', scored = true }) => {
          clearAnswerTimer();
          flushAllPendingRounds();
          const key = `preview:${qIndex}`;
          if (lastLoggedPhase !== key) {
            lastLoggedPhase = key;
            console.log(
              `[PYTANIE ${qIndex + 1}/${totalQuestions}] Podgląd pytania (${previewDuration}s, typ: ${questionType}${scored ? '' : '/opinia'})...`
            );
          }
          getRound(qIndex, totalQuestions, questionType, scored);
        }
      );

      socket.on('player_question_start', (qData) => {
        const {
          qIndex,
          questionType = 'abcd',
          scored = true,
          optionsCount,
          sliderMin,
          sliderMax,
          sliderStep,
          maxLength,
          timeLimit,
        } = qData;
        clearAnswerTimer();
        currentQIndex = qIndex;
        const round = getRound(qIndex, '?', questionType, scored);

        const key = `start:${qIndex}`;
        if (lastLoggedPhase !== key) {
          lastLoggedPhase = key;
          let details = `opcji: ${optionsCount ?? 4}`;
          if (questionType === 'slider') {
            details = `zakres: ${sliderMin}..${sliderMax}, krok: ${sliderStep}`;
          } else if (questionType === 'word_cloud') {
            details = `maks. znaków: ${maxLength ?? 32}`;
          }
          console.log(
            `[PYTANIE ${qIndex + 1}/${round.totalQuestions}] Start (${questionType}${scored ? '' : '/opinia'}, limit: ${timeLimit}s, ${details})`
          );
        }

        if (Math.random() > opts.answerRate) {
          return;
        }

        const defaultMax = Math.max(
          opts.minDelay + 50,
          Math.floor(timeLimit * 1000 * 0.8)
        );
        const effectiveMax =
          opts.maxDelay !== null ? opts.maxDelay : defaultMax;
        const span = Math.max(0, effectiveMax - opts.minDelay);
        const reactionMs = Math.floor(opts.minDelay + Math.random() * span);
        const answerPayload = buildAnswerPayload(qData, opts.words);

        pendingAnswerTimer = setTimeout(() => {
          pendingAnswerTimer = null;
          if (!socket.connected) return;
          pendingSubmitAt = performance.now();
          totalAnswersSent++;
          round.sent++;
          socket.emit('submit_answer', {
            pin: activePin,
            qIndex,
            ...answerPayload,
          });
        }, reactionMs);
      });

      socket.on('answer_locked', () => {
        if (pendingSubmitAt !== null && currentQIndex !== null) {
          const dt = performance.now() - pendingSubmitAt;
          pendingSubmitAt = null;
          totalAnswersLocked++;
          allAnswerLatencies.push(dt);
          const round = getRound(currentQIndex);
          round.locked++;
          round.latencies.push(dt);
        }
      });

      socket.on('error_msg', (msg) => {
        totalErrors++;
        if (msg === 'TIMEOUT_OR_INVALID_STATE' || msg === 'SERVER_ERROR') {
          pendingSubmitAt = null;
          totalAnswerRejects++;
          if (currentQIndex !== null) {
            getRound(currentQIndex).rejected++;
          }
        }
      });

      socket.on('player_question_end', ({ isCorrect, submitted, scored, questionType, sessionMode }) => {
        clearAnswerTimer();
        if (sessionMode) detectedSessionMode = sessionMode;
        if (currentQIndex === null) return;
        const round = getRound(
          currentQIndex,
          '?',
          questionType || null,
          scored !== undefined ? scored : null
        );
        const now = performance.now();
        if (round.firstEndAt === null) round.firstEndAt = now;
        round.lastEndAt = now;
        round.ended++;
        if (isCorrect) round.correct++;
        if (submitted) round.submitted++;

        if (round.ended >= activeConnected) {
          printRoundSummary(round);
        } else if (!round.flushTimer) {
          round.flushTimer = setTimeout(() => printRoundSummary(round), 400);
        }
      });

      socket.on('player_podium', ({ score, rank, sessionMode, hasScoredQuestions }) => {
        clearAnswerTimer();
        if (sessionMode) detectedSessionMode = sessionMode;
        if (hasScoredQuestions !== undefined) detectedHasScored = hasScoredQuestions;
        if (podiumFirstAt === null) {
          podiumFirstAt = performance.now();
        }
        podiumResults.push({ nickname, score, rank });

        if (podiumResults.length >= activeConnected) {
          cleanupAndExit(0, 'PODIUM');
        } else if (!podiumFinalizeTimer) {
          podiumFinalizeTimer = setTimeout(
            () => cleanupAndExit(0, 'PODIUM_TIMEOUT'),
            600
          );
        }
      });

      socket.on('game_aborted', ({ reason }) => {
        clearAnswerTimer();
        cleanupAndExit(0, `GRA_PRZERWANA:${reason || 'ABORTED'}`);
      });
    });

  // Rozłożone w czasie łączenie graczy
  const joinPromises = [];
  for (let i = 0; i < opts.players; i++) {
    joinPromises.push(spawnPlayer(i));
    if (delayStep > 0 && i < opts.players - 1) {
      await sleep(delayStep);
    }
  }
  await Promise.all(joinPromises);

  const joinTotalMs = performance.now() - joinStartAll;
  const joinStats = calcStats(joinLatencies);

  console.log(
    `[JOIN] Zakończono w ${fmtMs(joinTotalMs)} | Połączono: ${joinedCount}/${opts.players} | ` +
      `ACK p50/p95/max: ${fmtMs(joinStats.p50)} / ${fmtMs(joinStats.p95)} / ${fmtMs(joinStats.max)}`
  );

  if (joinedCount === 0) {
    const reasons = Array.from(joinErrors.entries())
      .map(([k, v]) => `${k} (${v}x)`)
      .join(', ');
    console.error(`[BŁĄD] Żaden gracz nie dołączył do pokoju ${activePin}. Powód: ${reasons || 'brak odpowiedzi'}`);
    if (joinErrors.has('ROOM_NOT_FOUND')) {
      console.error('Wskazówka: upewnij się, że sesja została utworzona i PIN jest poprawny.');
    } else if (joinErrors.has('GAME_ALREADY_IN_PROGRESS')) {
      console.error('Wskazówka: sesja musi być w fazie LOBBY (przed kliknięciem START).');
    }
    cleanupAndExit(1, 'JOIN_FAILED');
    return;
  }

  if (opts.autoHost && hostSocket) {
    console.log(`[HOST] Uruchamianie gry dla ${joinedCount} graczy...`);
    hostSocket.emit('host_start_game', { pin: activePin });
  } else {
    console.log(
      `[OCZEKIWANIE] ${joinedCount} graczy czeka w LOBBY pokoju ${activePin}. Uruchom grę w panelu prowadzącego!`
    );
  }
}

main().catch((err) => {
  console.error('Krytyczny błąd skryptu:', err);
  process.exit(1);
});
