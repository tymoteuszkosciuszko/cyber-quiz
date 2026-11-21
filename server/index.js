import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORS_ORIGIN =
  process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : '*';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

const httpServer = createServer(app);

// Optymalizacja pod 200+ połączeń: wyłączenie kompresji perMessageDeflate oszczędza CPU i RAM
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN },
  perMessageDeflate: false,
  pingInterval: 25000,
  pingTimeout: 20000,
});

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  ...(process.env.REDIS_PASSWORD
    ? { password: process.env.REDIS_PASSWORD }
    : {}),
});

redis.on('error', (err) => {
  console.error('[REDIS_ERROR]', err.message);
});

// Stałe czasowe rozgrywki
const START_COUNTDOWN_SECONDS = 3;
const QUESTION_PREVIEW_SECONDS = 5;
const AUTO_NEXT_SECONDS = 6;

// ==========================================
// Baza quizów w pamięci (z domyślnym quizem startowym)
// ==========================================
const quizzes = new Map();
const defaultQuizId = 'default-cyber-quiz';
quizzes.set(defaultQuizId, {
  id: defaultQuizId,
  title: 'PROTOKÓŁ: BEZPIECZEŃSTWO SIECIOWE_v1.0',
  questions: [
    {
      content: 'Który port domyślnie odpowiada za szyfrowany ruch HTTPS?',
      timeLimit: 15,
      answers: ['Port 80', 'Port 443', 'Port 22', 'Port 8080'],
      correctIndex: 1,
    },
    {
      content:
        'Jaka jest złożoność czasowa operacji ZADD w strukturze Sorted Set (Redis)?',
      timeLimit: 20,
      answers: ['O(1)', 'O(log N)', 'O(N)', 'O(N²)'],
      correctIndex: 1,
    },
    {
      content:
        'Co oznacza skrót XSS w kontekście podatności aplikacji webowych?',
      timeLimit: 15,
      answers: [
        'Extreme Server Security',
        'Cross-Site Scripting',
        'XML System Socket',
        'X-Ray Socket Layer',
      ],
      correctIndex: 1,
    },
    {
      content:
        'Który atak polega na przechwytywaniu komunikacji między dwiema stronami bez ich wiedzy?',
      timeLimit: 20,
      answers: [
        'Brute Force',
        'Phishing',
        'Man-in-the-Middle',
        'SQL Injection',
      ],
      correctIndex: 2,
    },
    {
      content: 'Jakie rozszerzenie pliku najczęściej kojarzy się z ransomware?',
      timeLimit: 15,
      answers: ['.locked / .crypt', '.pdf', '.docx', '.html'],
      correctIndex: 0,
    },
  ],
});

// Aktywne timery pokojów w pamięci procesu Node.js
const roomTimers = new Map();

// ==========================================
// REST API — EDYTOR QUIZÓW
// ==========================================

app.get('/api/quizzes', (_req, res) => {
  const list = Array.from(quizzes.values()).map((q) => ({
    id: q.id,
    title: q.title,
    questionsCount: q.questions.length,
  }));
  res.json(list);
});

app.get('/api/quizzes/:id', (req, res) => {
  const quiz = quizzes.get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'QUIZ_NOT_FOUND' });
  res.json(quiz);
});

app.post('/api/quizzes', (req, res) => {
  const { title, questions } = req.body;
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }
  const id = uuidv4();
  const newQuiz = { id, title, questions };
  quizzes.set(id, newQuiz);
  res.status(201).json(newQuiz);
});

// Aktualizacja istniejącego quizu
app.put('/api/quizzes/:id', (req, res) => {
  if (!quizzes.has(req.params.id)) {
    return res.status(404).json({ error: 'QUIZ_NOT_FOUND' });
  }
  const { title, questions } = req.body;
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }
  const updated = { id: req.params.id, title, questions };
  quizzes.set(req.params.id, updated);
  res.json(updated);
});

// Usunięcie quizu
app.delete('/api/quizzes/:id', (req, res) => {
  if (!quizzes.has(req.params.id)) {
    return res.status(404).json({ error: 'QUIZ_NOT_FOUND' });
  }
  quizzes.delete(req.params.id);
  res.json({ message: 'QUIZ_DELETED' });
});

// ==========================================
// HEALTHCHECK & SERWOWANIE FRONTENDU (PROD)
// ==========================================

app.get('/health', async (_req, res) => {
  try {
    await redis.ping();
    res.status(200).json({ status: 'ok', redis: 'ready' });
  } catch (_err) {
    res.status(503).json({ status: 'degraded', redis: 'unavailable' });
  }
});

const STATIC_DIR =
  process.env.STATIC_DIR || path.resolve(__dirname, '../client/dist');
const INDEX_HTML = path.join(STATIC_DIR, 'index.html');

if (fs.existsSync(INDEX_HTML)) {
  app.use(
    '/assets',
    express.static(path.join(STATIC_DIR, 'assets'), {
      maxAge: '1y',
      immutable: true,
    })
  );
  app.use(
    express.static(STATIC_DIR, {
      index: false,
      maxAge: '1h',
    })
  );

  // SPA fallback (obsługuje "/", "/game-admin", "/game-screen")
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(INDEX_HTML);
  });
}

// ==========================================
// FUNKCJE POMOCNICZE SILNIKA GRY
// ==========================================

function clearRoomTimers(pin) {
  const timers = roomTimers.get(pin);
  if (timers) {
    clearTimeout(timers.countdownTimer);
    clearTimeout(timers.previewTimer);
    clearTimeout(timers.questionTimer);
    clearInterval(timers.throttleInterval);
    clearTimeout(timers.autoNextTimer);
    roomTimers.delete(pin);
  }
}

async function getFullLeaderboard(pin) {
  const raw = await redis.zrevrange(
    `room:${pin}:leaderboard`,
    0,
    -1,
    'WITHSCORES'
  );
  const results = [];
  for (let i = 0; i < raw.length; i += 2) {
    results.push({
      nickname: raw[i],
      score: Number(raw[i + 1]),
      place: i / 2 + 1,
    });
  }
  return results;
}

async function notifyScreenStatus(pin) {
  const screenSockets = await io.in(`screen:${pin}`).fetchSockets();
  io.to(`controller:${pin}`).emit('screen_status_update', {
    connectedScreens: screenSockets.length,
  });
}

async function buildRoomSnapshot(pin) {
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || !state.status) {
    return { error: 'ROOM_NOT_FOUND' };
  }

  const quiz = quizzes.get(state.quiz_id);
  const fullResults = await getFullLeaderboard(pin);
  const totalPlayers = fullResults.length;
  const qIndex = Number(state.current_q_index ?? -1);
  const now = Date.now();
  const phaseStart = Number(state.phase_start_timestamp || 0);
  const phaseDuration = Number(state.phase_duration_ms || 0);
  const remainingMs = Math.max(0, phaseDuration - (now - phaseStart));

  const base = {
    pin,
    status: state.status,
    quizTitle: quiz?.title || 'Cyber Quiz',
    totalQuestions: quiz?.questions.length || 0,
    players: fullResults.map((p) => p.nickname),
  };

  if (state.status === 'COUNTDOWN') {
    return {
      ...base,
      countdownSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  if (state.status === 'QUESTION_PREVIEW' && quiz && quiz.questions[qIndex]) {
    const question = quiz.questions[qIndex];
    return {
      ...base,
      currentQuestion: {
        qIndex,
        totalQuestions: quiz.questions.length,
        content: question.content,
        timeLimit: question.timeLimit,
        totalPlayers,
        previewDuration: QUESTION_PREVIEW_SECONDS,
        previewRemaining: +(remainingMs / 1000).toFixed(1),
      },
    };
  }

  if (state.status === 'QUESTION' && quiz && quiz.questions[qIndex]) {
    const question = quiz.questions[qIndex];
    const currentCount = await redis.hlen(`room:${pin}:answers:${qIndex}`);
    return {
      ...base,
      currentQuestion: {
        qIndex,
        totalQuestions: quiz.questions.length,
        content: question.content,
        answers: question.answers,
        timeLimit: question.timeLimit,
        totalPlayers,
      },
      timeLeft: +(remainingMs / 1000).toFixed(1),
      answerCount: { count: currentCount, total: totalPlayers },
    };
  }

  if (state.status === 'LEADERBOARD' && quiz && quiz.questions[qIndex]) {
    const question = quiz.questions[qIndex];
    let distribution = [0, 0, 0, 0];
    try {
      if (state.last_distribution) {
        distribution = JSON.parse(state.last_distribution);
      }
    } catch (_err) {
      // fallback default distribution
    }
    const isPaused = state.auto_next_paused === '1';
    return {
      ...base,
      currentQuestion: {
        qIndex,
        totalQuestions: quiz.questions.length,
        content: question.content,
        answers: question.answers,
        timeLimit: question.timeLimit,
        totalPlayers,
      },
      leaderboardData: {
        qIndex,
        correctIndex: Number(state.correct_index),
        distribution,
        topPlayers: fullResults.slice(0, 5),
        autoNextIn: isPaused ? 0 : Math.ceil(remainingMs / 1000),
        isLastQuestion: qIndex + 1 >= quiz.questions.length,
        isPaused,
      },
    };
  }

  if (state.status === 'PODIUM') {
    return {
      ...base,
      podium: fullResults.slice(0, 3),
      allResults: fullResults,
    };
  }

  return base;
}

// Faza 1 rundy: Podgląd samego pytania przez 5 sekund przed ujawnieniem odpowiedzi
async function startQuestionPreview(pin, qIndex) {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || !state.quiz_id || state.status === 'ABORTED') return;

  const quiz = quizzes.get(state.quiz_id);
  if (!quiz || qIndex >= quiz.questions.length) {
    return finishQuiz(pin);
  }

  const question = quiz.questions[qIndex];
  const now = Date.now();
  const previewDurationMs = QUESTION_PREVIEW_SECONDS * 1000;

  // Wyczyść odpowiedzi dla tego indeksu pytania
  await redis.del(`room:${pin}:answers:${qIndex}`);
  await redis.del(`room:${pin}:earned:${qIndex}`);

  await redis.hmset(`room:${pin}:state`, {
    status: 'QUESTION_PREVIEW',
    current_q_index: qIndex,
    phase_start_timestamp: now,
    phase_duration_ms: previewDurationMs,
    correct_index: question.correctIndex,
    auto_next_paused: '0',
  });

  const totalPlayers = await redis.zcard(`room:${pin}:leaderboard`);

  // Do Hosta i Ekranu gry wysyłamy treść pytania + odliczanie do ujawnienia odpowiedzi
  io.to(`host:${pin}`).emit('host_question_preview', {
    qIndex,
    totalQuestions: quiz.questions.length,
    content: question.content,
    timeLimit: question.timeLimit,
    totalPlayers,
    previewDuration: QUESTION_PREVIEW_SECONDS,
  });

  // Do Graczy (Smartfony) wysyłamy sygnał podglądu pytania (przyciski jeszcze zablokowane)
  io.to(`players:${pin}`).emit('player_question_preview', {
    qIndex,
    totalQuestions: quiz.questions.length,
    previewDuration: QUESTION_PREVIEW_SECONDS,
  });

  // Po 5 sekundach ujawniamy odpowiedzi i uruchamiamy właściwy timer pytania
  const previewTimer = setTimeout(() => {
    revealAnswersAndStartQuestion(pin, qIndex);
  }, previewDurationMs);

  roomTimers.set(pin, { previewTimer });
}

// Faza 2 rundy: Ujawnienie odpowiedzi i start właściwego licznika czasu
async function revealAnswersAndStartQuestion(pin, qIndex) {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (
    !state ||
    !state.quiz_id ||
    state.status !== 'QUESTION_PREVIEW' ||
    Number(state.current_q_index) !== qIndex
  ) {
    return;
  }

  const quiz = quizzes.get(state.quiz_id);
  if (!quiz || !quiz.questions[qIndex]) {
    return finishQuiz(pin);
  }

  const question = quiz.questions[qIndex];
  const now = Date.now();
  const timeLimitMs = question.timeLimit * 1000;

  // Zapisz stan aktywnego pytania w Redisie (punktacja liczona od ujawnienia odpowiedzi!)
  await redis.hmset(`room:${pin}:state`, {
    status: 'QUESTION',
    current_q_index: qIndex,
    question_start_timestamp: now,
    phase_start_timestamp: now,
    phase_duration_ms: timeLimitMs,
    time_limit_ms: timeLimitMs,
    correct_index: question.correctIndex,
  });

  const totalPlayers = await redis.zcard(`room:${pin}:leaderboard`);

  // 1. Do Hosta i Ekranu gry (Rzutnik) wysyłamy pełną treść pytania z odpowiedziami
  io.to(`host:${pin}`).emit('host_question_start', {
    qIndex,
    totalQuestions: quiz.questions.length,
    content: question.content,
    answers: question.answers,
    timeLimit: question.timeLimit,
    totalPlayers,
  });

  // 2. Do Graczy (Smartfony) wysyłamy lekki sygnał odblokowania przycisków (kilkadziesiąt bajtów)
  io.to(`players:${pin}`).emit('player_question_start', {
    qIndex,
    optionsCount: question.answers.length,
    timeLimit: question.timeLimit,
  });

  let lastBroadcastCount = 0;

  // Throttling: wysyłanie liczby odpowiedzi do hosta i ekranu maksymalnie raz na 250 ms
  const throttleInterval = setInterval(async () => {
    try {
      const currentCount = await redis.hlen(`room:${pin}:answers:${qIndex}`);
      if (currentCount !== lastBroadcastCount) {
        lastBroadcastCount = currentCount;
        io.to(`host:${pin}`).emit('answer_count_update', {
          count: currentCount,
          total: totalPlayers,
        });
      }
      // Jeśli wszyscy gracze odpowiedzieli, kończymy pytanie przed czasem
      if (totalPlayers > 0 && currentCount >= totalPlayers) {
        endQuestion(pin, qIndex);
      }
    } catch (_err) {
      // ignore redis errors during throttle
    }
  }, 250);

  // Główny timer pytania — automatyczne zakończenie po upływie czasu
  const questionTimer = setTimeout(() => {
    endQuestion(pin, qIndex);
  }, timeLimitMs);

  roomTimers.set(pin, { questionTimer, throttleInterval });
}

async function endQuestion(pin, qIndex) {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || state.status !== 'QUESTION') return;

  const quiz = quizzes.get(state.quiz_id);
  if (!quiz) return;

  const correctIndex = Number(state.correct_index);

  // Statystyki odpowiedzi (ile osób kliknęło A, B, C, D)
  const rawAnswers = await redis.hgetall(`room:${pin}:answers:${qIndex}`);
  const distribution = [0, 0, 0, 0];
  Object.values(rawAnswers).forEach((ans) => {
    const idx = Number(ans);
    if (idx >= 0 && idx < 4) distribution[idx]++;
  });

  const now = Date.now();
  await redis.hmset(`room:${pin}:state`, {
    status: 'LEADERBOARD',
    phase_start_timestamp: now,
    phase_duration_ms: AUTO_NEXT_SECONDS * 1000,
    auto_next_paused: '0',
    last_distribution: JSON.stringify(distribution),
  });

  // Pobranie Top 5 z Redis Sorted Set
  const topRaw = await redis.zrevrange(
    `room:${pin}:leaderboard`,
    0,
    4,
    'WITHSCORES'
  );
  const topPlayers = [];
  for (let i = 0; i < topRaw.length; i += 2) {
    topPlayers.push({
      nickname: topRaw[i],
      score: Number(topRaw[i + 1]),
    });
  }

  const isLastQuestion = qIndex + 1 >= quiz.questions.length;

  // Wysłanie tablicy wyników i poprawnej odpowiedzi do Hosta i Ekranu gry
  io.to(`host:${pin}`).emit('host_question_end', {
    qIndex,
    correctIndex,
    distribution,
    topPlayers,
    autoNextIn: AUTO_NEXT_SECONDS,
    isLastQuestion,
    isPaused: false,
  });

  // Wysłanie indywidualnego statusu do każdego gracza
  const sockets = await io.in(`players:${pin}`).fetchSockets();
  for (const s of sockets) {
    const nickname = s.data.nickname;
    if (!nickname) continue;

    const score = await redis.zscore(`room:${pin}:leaderboard`, nickname);
    const rank = await redis.zrevrank(`room:${pin}:leaderboard`, nickname);
    const playerAnswer = rawAnswers[s.id];
    const isCorrect =
      playerAnswer !== undefined && Number(playerAnswer) === correctIndex;

    const earnedPoints = Number(
      (await redis.hget(`room:${pin}:earned:${qIndex}`, nickname)) || 0
    );

    s.emit('player_question_end', {
      isCorrect,
      earnedPoints,
      correctIndex,
      score: Number(score || 0),
      rank: rank !== null ? rank + 1 : null,
    });
  }

  // Automatyczne przełączenie do kolejnego pytania (podgląd) po 6 sekundach
  const autoNextTimer = setTimeout(() => {
    startQuestionPreview(pin, qIndex + 1);
  }, AUTO_NEXT_SECONDS * 1000);

  roomTimers.set(pin, { autoNextTimer });
}

async function finishQuiz(pin) {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || state.status === 'ABORTED') return;

  await redis.hset(`room:${pin}:state`, 'status', 'PODIUM');

  // Pełna tabela wyników + Top 3 na podium z Redis ZSET
  const allResults = await getFullLeaderboard(pin);
  const podium = allResults.slice(0, 3);

  io.to(`host:${pin}`).emit('host_podium', { podium, allResults });

  // Wysłanie ostatecznej pozycji na telefony uczestników
  const sockets = await io.in(`players:${pin}`).fetchSockets();
  const totalPlayers = allResults.length;

  for (const s of sockets) {
    const nickname = s.data.nickname;
    if (!nickname) continue;
    const score = await redis.zscore(`room:${pin}:leaderboard`, nickname);
    const rank = await redis.zrevrank(`room:${pin}:leaderboard`, nickname);
    s.emit('player_podium', {
      score: Number(score || 0),
      rank: rank !== null ? rank + 1 : null,
      totalPlayers,
    });
  }
}

async function abortGame(pin, reason = 'HOST_ABORTED') {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || !state.status) return;

  await redis.hset(`room:${pin}:state`, 'status', 'ABORTED');

  io.to(`host:${pin}`).emit('game_aborted', { reason });
  io.to(`players:${pin}`).emit('game_aborted', { reason });
}

// ==========================================
// OBSŁUGA POŁĄCZEŃ WEBSOCKET
// ==========================================

io.on('connection', (socket) => {
  // 1. Host (Panel prowadzącego) tworzy pokój
  socket.on('host_create_room', async ({ quizId }, callback) => {
    try {
      const targetQuizId = quizId || defaultQuizId;
      const quiz = quizzes.get(targetQuizId);
      if (!quiz) return callback({ error: 'QUIZ_NOT_FOUND' });

      // Jeśli ten kontroler był wcześniej w innym pokoju, opuść stare pokoje
      if (socket.data.pin && socket.data.isController) {
        socket.leave(`host:${socket.data.pin}`);
        socket.leave(`controller:${socket.data.pin}`);
      }

      const pin = Math.floor(100000 + Math.random() * 900000).toString();

      await redis.del(`room:${pin}:leaderboard`);
      await redis.hmset(`room:${pin}:state`, {
        status: 'LOBBY',
        quiz_id: targetQuizId,
        current_q_index: -1,
        host_socket_id: socket.id,
        auto_next_paused: '0',
      });
      // TTL na klucze pokoju (2 godziny)
      await redis.expire(`room:${pin}:state`, 7200);

      socket.join(`host:${pin}`);
      socket.join(`controller:${pin}`);
      socket.data.pin = pin;
      socket.data.isHost = true;
      socket.data.isController = true;

      callback({ pin, quiz });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // 1b. Ekran gry (osobne okno / rzutnik) dołącza do pokoju i pobiera pełny stan
  socket.on('screen_join_room', async ({ pin }, callback) => {
    try {
      const cleanPin = String(pin || '').trim();
      if (!cleanPin) return callback({ error: 'MISSING_PIN' });

      const snapshot = await buildRoomSnapshot(cleanPin);
      if (snapshot.error) return callback(snapshot);

      if (socket.data.pin && socket.data.isScreen && socket.data.pin !== cleanPin) {
        const oldPin = socket.data.pin;
        socket.leave(`host:${oldPin}`);
        socket.leave(`screen:${oldPin}`);
        await notifyScreenStatus(oldPin);
      }

      socket.join(`host:${cleanPin}`);
      socket.join(`screen:${cleanPin}`);
      socket.data.pin = cleanPin;
      socket.data.isScreen = true;

      await notifyScreenStatus(cleanPin);
      callback(snapshot);
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // 2. Gracz dołącza do pokoju (przez kod QR lub PIN + Nickname)
  socket.on('player_join', async ({ pin, nickname }, callback) => {
    try {
      const cleanNick = (nickname || '').trim().toUpperCase().slice(0, 16);
      if (!cleanNick) return callback({ error: 'INVALID_NICKNAME' });

      const cleanPin = String(pin || '').trim();
      if (!cleanPin) return callback({ error: 'MISSING_PIN' });

      const state = await redis.hgetall(`room:${cleanPin}:state`);
      if (!state || !state.status)
        return callback({ error: 'ROOM_NOT_FOUND' });
      if (state.status !== 'LOBBY')
        return callback({ error: 'GAME_ALREADY_IN_PROGRESS' });

      // Sprawdzenie duplikatu nicka w czasie O(1) — Redis ZSCORE
      const existing = await redis.zscore(
        `room:${cleanPin}:leaderboard`,
        cleanNick
      );
      if (existing !== null) return callback({ error: 'NICKNAME_TAKEN' });

      // Dodanie gracza do leaderboardu z wynikiem 0
      await redis.zadd(`room:${cleanPin}:leaderboard`, 0, cleanNick);

      socket.data.pin = cleanPin;
      socket.data.nickname = cleanNick;
      socket.join(`players:${cleanPin}`);

      const totalPlayers = await redis.zcard(`room:${cleanPin}:leaderboard`);

      // Powiadom Hosta i Ekran gry o nowym graczu
      io.to(`host:${cleanPin}`).emit('player_joined', {
        nickname: cleanNick,
        totalPlayers,
      });

      callback({ success: true, nickname: cleanNick });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // 3. Host uruchamia grę — krótkie odliczanie startowe, a potem podgląd 1. pytania
  socket.on('host_start_game', async ({ pin }) => {
    const state = await redis.hgetall(`room:${pin}:state`);
    if (!state || state.status !== 'LOBBY') return;

    const now = Date.now();
    await redis.hmset(`room:${pin}:state`, {
      status: 'COUNTDOWN',
      phase_start_timestamp: now,
      phase_duration_ms: START_COUNTDOWN_SECONDS * 1000,
    });

    // Powiadom hosta, ekran gry i graczy o rozpoczęciu odliczania
    io.to(`host:${pin}`).emit('host_countdown', {
      seconds: START_COUNTDOWN_SECONDS,
    });
    io.to(`players:${pin}`).emit('player_countdown', {
      seconds: START_COUNTDOWN_SECONDS,
    });

    // Start podglądu pierwszego pytania po odliczaniu
    const countdownTimer = setTimeout(() => {
      startQuestionPreview(pin, 0);
    }, START_COUNTDOWN_SECONDS * 1000);

    roomTimers.set(pin, { countdownTimer });
  });

  // 4. Wymuszenie przejścia dalej przez Hosta (działa w każdej aktywnej fazie)
  socket.on('host_force_next', async ({ pin }) => {
    const state = await redis.hgetall(`room:${pin}:state`);
    if (!state) return;
    const currentIdx = Number(state.current_q_index);

    if (state.status === 'COUNTDOWN') {
      await startQuestionPreview(pin, 0);
    } else if (state.status === 'QUESTION_PREVIEW') {
      await revealAnswersAndStartQuestion(pin, currentIdx);
    } else if (state.status === 'QUESTION') {
      await endQuestion(pin, currentIdx);
    } else if (state.status === 'LEADERBOARD') {
      clearRoomTimers(pin);
      await startQuestionPreview(pin, currentIdx + 1);
    }
  });

  // 4b. Wstrzymanie / wznowienie automatycznego przejścia po wynikach rundy
  socket.on('host_toggle_pause', async ({ pin }) => {
    const state = await redis.hgetall(`room:${pin}:state`);
    if (!state || state.status !== 'LEADERBOARD') return;

    const currentIdx = Number(state.current_q_index);
    const isCurrentlyPaused = state.auto_next_paused === '1';

    if (!isCurrentlyPaused) {
      clearRoomTimers(pin);
      await redis.hset(`room:${pin}:state`, 'auto_next_paused', '1');
      io.to(`host:${pin}`).emit('host_auto_next_status', {
        isPaused: true,
        autoNextIn: 0,
      });
    } else {
      clearRoomTimers(pin);
      const now = Date.now();
      await redis.hmset(`room:${pin}:state`, {
        auto_next_paused: '0',
        phase_start_timestamp: now,
        phase_duration_ms: AUTO_NEXT_SECONDS * 1000,
      });
      io.to(`host:${pin}`).emit('host_auto_next_status', {
        isPaused: false,
        autoNextIn: AUTO_NEXT_SECONDS,
      });
      const autoNextTimer = setTimeout(() => {
        startQuestionPreview(pin, currentIdx + 1);
      }, AUTO_NEXT_SECONDS * 1000);
      roomTimers.set(pin, { autoNextTimer });
    }
  });

  // 4c. Przerwanie gry przez prowadzącego
  socket.on('host_abort_game', async ({ pin }, callback) => {
    try {
      await abortGame(pin, 'HOST_ABORTED');
      if (socket.data.pin === pin) {
        socket.leave(`host:${pin}`);
        socket.leave(`controller:${pin}`);
        socket.data.pin = null;
      }
      callback?.({ success: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  // 4d. Zamknięcie sesji po zakończeniu podium (powrót prowadzącego do menu)
  socket.on('host_leave_room', async ({ pin }, callback) => {
    try {
      clearRoomTimers(pin);
      if (socket.data.pin === pin) {
        socket.leave(`host:${pin}`);
        socket.leave(`controller:${pin}`);
        socket.data.pin = null;
      }
      callback?.({ success: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  // 5. Odbiór odpowiedzi od gracza w czasie rzeczywistym
  socket.on('submit_answer', async ({ pin, qIndex, answerIndex }) => {
    try {
      const now = Date.now();
      const state = await redis.hgetall(`room:${pin}:state`);

      if (
        !state ||
        state.status !== 'QUESTION' ||
        Number(state.current_q_index) !== qIndex
      ) {
        return socket.emit('error_msg', 'TIMEOUT_OR_INVALID_STATE');
      }

      // Atomowe sprawdzenie czy gracz już odpowiedział (HSETNX)
      const isFirstAnswer = await redis.hsetnx(
        `room:${pin}:answers:${qIndex}`,
        socket.id,
        answerIndex
      );
      if (!isFirstAnswer) return;

      const isCorrect = Number(answerIndex) === Number(state.correct_index);
      if (isCorrect && socket.data.nickname) {
        const timeElapsed = Math.max(
          0,
          now - Number(state.question_start_timestamp)
        );
        const timeLimit = Number(state.time_limit_ms);
        // Algorytm punktacji: P = floor(P_base * (1 - T_elapsed / (T_limit * 2)))
        // Minimum 500 pkt za poprawną odpowiedź
        const points = Math.max(
          500,
          Math.floor(1000 * (1 - timeElapsed / (timeLimit * 2)))
        );
        await redis.zincrby(
          `room:${pin}:leaderboard`,
          points,
          socket.data.nickname
        );
        // Zapisz ile punktów zdobył gracz za to pytanie
        await redis.hset(
          `room:${pin}:earned:${qIndex}`,
          socket.data.nickname,
          points
        );
      }

      socket.emit('answer_locked', { status: 'PACKET_UPLOADED' });
    } catch (_err) {
      socket.emit('error_msg', 'SERVER_ERROR');
    }
  });

  // Czyszczenie po rozłączeniu
  socket.on('disconnect', async () => {
    if (socket.data.isScreen && socket.data.pin) {
      await notifyScreenStatus(socket.data.pin);
    }
    if (socket.data.isController && socket.data.pin) {
      const remaining = await io
        .in(`controller:${socket.data.pin}`)
        .fetchSockets();
      if (remaining.length === 0) {
        clearRoomTimers(socket.data.pin);
      }
    }
  });
});

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  [CYBER_QUIZ_SERVER] ONLINE              ║`);
  console.log(`  ║  Port: ${PORT}                              ║`);
  console.log(`  ║  Redis: ${REDIS_HOST}:${REDIS_PORT}`);
  console.log(`  ║  Static UI: ${fs.existsSync(INDEX_HTML) ? 'ENABLED' : 'DEV (no dist)'}`);
  console.log(`  ║  WebSocket: perMessageDeflate OFF        ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});

function shutdown(signal) {
  console.log(`\n[CYBER_QUIZ_SERVER] Otrzymano ${signal}, zamykanie...`);
  for (const pin of roomTimers.keys()) {
    clearRoomTimers(pin);
  }
  io.close(() => {
    httpServer.close(async () => {
      try {
        await redis.quit();
      } catch (_err) {
        redis.disconnect();
      }
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
