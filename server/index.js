import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createPool, initDatabase } from './db/pool.js';
import { DEFAULT_QUIZ_ID } from './db/seedTemplates.js';
import {
  cloneQuiz,
  createQuiz,
  deleteQuiz,
  getQuizByIdForUser,
  getQuizByIdInternal,
  listQuizzesForUser,
  updateQuiz,
} from './db/quizRepository.js';
import { createAuthRouter } from './auth/authRoutes.js';
import { createAdminRouter } from './auth/adminRoutes.js';
import { createMfaRouter } from './auth/mfaRoutes.js';
import { getWebAuthnConfig } from './auth/webauthn.js';
import {
  createRequireAuth,
  createRequireCsrf,
  createSocketAuthMiddleware,
  isOriginAllowed,
} from './auth/middleware.js';
import { getSessionByHash } from './auth/sessions.js';
import { extractReqMeta, logAudit } from './auth/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_PROD = process.env.NODE_ENV === 'production';
const RAW_CORS_ORIGIN = (process.env.CORS_ORIGIN || '').trim();

if (IS_PROD && (!RAW_CORS_ORIGIN || RAW_CORS_ORIGIN === '*')) {
  console.error(
    '[SECURITY_CONFIG_ERROR] W produkcji CORS_ORIGIN musi być jawnym adresem (np. https://quiz.twojadomena.pl), nie "*".'
  );
  process.exit(1);
}

const ALLOWED_ORIGINS =
  RAW_CORS_ORIGIN && RAW_CORS_ORIGIN !== '*'
    ? RAW_CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : '*';

const corsOriginValidator = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (isOriginAllowed(origin, ALLOWED_ORIGINS)) {
    return callback(null, true);
  }
  return callback(null, false);
};

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);
app.use(
  cors({
    origin: corsOriginValidator,
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));

const httpServer = createServer(app);

// Optymalizacja pod 200+ połączeń: wyłączenie kompresji perMessageDeflate oszczędza CPU i RAM
const io = new Server(httpServer, {
  cors: {
    origin: corsOriginValidator,
    credentials: true,
  },
  perMessageDeflate: false,
  maxHttpBufferSize: 15e6,
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

const pool = createPool();
pool.on('error', (err) => {
  console.error('[POSTGRES_ERROR]', err.message);
});

// Middleware uwierzytelniania dla Socket.IO (publiczne połączenia graczy/ekranu są dozwolone bez sesji)
io.use(createSocketAuthMiddleware(redis, ALLOWED_ORIGINS));

// Stałe czasowe rozgrywki
const START_COUNTDOWN_SECONDS = 3;
const QUESTION_PREVIEW_SECONDS = 5;
const AUTO_NEXT_SECONDS = 6;

// ==========================================
// TRYBY QUIZU I DOZWOLONE FORMY PYTAŃ
// ==========================================
const VALID_MODES = new Set(['quiz', 'opinion', 'mixed']);
const MODE_ALLOWED_TYPES = {
  quiz: new Set(['abcd', 'true_false', 'slider']),
  opinion: new Set(['poll', 'word_cloud', 'slider']),
  mixed: new Set(['abcd', 'true_false', 'slider', 'poll', 'word_cloud']),
};

function resolveQuestionType(question) {
  return question?.type || 'abcd';
}

function resolveQuestionScored(question, quizMode = 'quiz') {
  const type = resolveQuestionType(question);
  if (quizMode === 'opinion') return false;
  if (type === 'poll' || type === 'word_cloud') return false;
  if (type === 'abcd' || type === 'true_false') return true;
  if (type === 'slider') {
    if (quizMode === 'quiz') return true;
    return question?.scored !== false;
  }
  return true;
}

function quizHasScoredQuestions(quiz) {
  if (!quiz) return true;
  const mode = quiz.mode || 'quiz';
  if (mode === 'opinion') return false;
  return quiz.questions.some((q) => resolveQuestionScored(q, mode));
}

// Aktywne timery i cache snapshotów quizów dla bieżących pokojów (O(1) dla 200+ graczy)
const roomTimers = new Map();
const roomQuizCache = new Map();

async function getActiveRoomQuiz(pin, quizId) {
  if (pin && roomQuizCache.has(pin)) {
    return roomQuizCache.get(pin);
  }
  if (pin) {
    const cachedJson = await redis.get(`room:${pin}:quiz`);
    if (cachedJson) {
      try {
        const parsed = JSON.parse(cachedJson);
        roomQuizCache.set(pin, parsed);
        return parsed;
      } catch {
        // fallback do PostgreSQL
      }
    }
  }
  if (!quizId) return null;
  const fromDb = await getQuizByIdInternal(pool, quizId);
  if (fromDb && pin) {
    roomQuizCache.set(pin, fromDb);
  }
  return fromDb;
}

// ==========================================
// WALIDACJA I NORMALIZACJA PYTAŃ (TRYBY, FORMY, ZDJĘCIA)
// ==========================================

const MAX_IMAGE_STR_LENGTH = 3_500_000;

function sanitizeImageValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_IMAGE_STR_LENGTH) return null;
  const isDataUrl =
    /^data:image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(
      trimmed
    );
  const isHttpUrl = /^https?:\/\/.+/i.test(trimmed);
  return isDataUrl || isHttpUrl ? trimmed : null;
}

function normalizeAndValidateQuestions(rawQuestions, rawMode = 'quiz') {
  const mode = VALID_MODES.has(rawMode) ? rawMode : 'quiz';
  const allowedTypes = MODE_ALLOWED_TYPES[mode];

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return { error: 'INVALID_PAYLOAD' };
  }

  const normalized = [];
  for (const raw of rawQuestions) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'INVALID_QUESTION' };
    }

    const type = typeof raw.type === 'string' ? raw.type.trim() : 'abcd';
    if (!allowedTypes.has(type)) {
      return { error: `UNSUPPORTED_QUESTION_TYPE_FOR_MODE:${type}` };
    }

    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    const image = sanitizeImageValue(raw.image);

    if (!content && !image) {
      return { error: 'EMPTY_QUESTION' };
    }

    let timeLimit = 20;
    if (
      raw.timeLimit === 0 ||
      raw.timeLimit === '0' ||
      raw.timeLimit === null
    ) {
      timeLimit = 0;
    } else if (raw.timeLimit !== undefined && raw.timeLimit !== '') {
      const rawTime = Number(raw.timeLimit);
      if (Number.isFinite(rawTime)) {
        timeLimit = Math.min(120, Math.max(5, Math.round(rawTime)));
      }
    }

    const scored = resolveQuestionScored({ ...raw, type }, mode);
    const questionObj = {
      type,
      content,
      timeLimit,
      scored,
    };

    if (image) {
      questionObj.image = image;
    }

    if (type === 'abcd' || type === 'true_false' || type === 'poll') {
      const defaultAnswers =
        type === 'true_false' ? ['Prawda', 'Fałsz'] : raw.answers;
      if (
        !Array.isArray(defaultAnswers) ||
        defaultAnswers.length < 2 ||
        defaultAnswers.length > 4 ||
        (type === 'true_false' && defaultAnswers.length !== 2)
      ) {
        return { error: 'INVALID_ANSWERS' };
      }

      const answers = defaultAnswers.map((a, idx) => {
        const str = typeof a === 'string' ? a.trim() : '';
        if (type === 'true_false' && !str) {
          return idx === 0 ? 'Prawda' : 'Fałsz';
        }
        return str;
      });

      const rawAnswerImages = Array.isArray(raw.answerImages)
        ? raw.answerImages
        : [];
      const answerImages = answers.map((_, idx) =>
        sanitizeImageValue(rawAnswerImages[idx])
      );

      for (let i = 0; i < answers.length; i++) {
        if (!answers[i] && !answerImages[i]) {
          return { error: 'EMPTY_ANSWER' };
        }
      }

      questionObj.answers = answers;
      if (answerImages.some(Boolean)) {
        questionObj.answerImages = answerImages;
      }

      if (type === 'abcd' || type === 'true_false') {
        const correctIndex = Number(raw.correctIndex);
        if (
          !Number.isInteger(correctIndex) ||
          correctIndex < 0 ||
          correctIndex >= answers.length
        ) {
          return { error: 'INVALID_CORRECT_INDEX' };
        }
        questionObj.correctIndex = correctIndex;
      }
    } else if (type === 'slider') {
      const sliderMin = Number(raw.sliderMin);
      const sliderMax = Number(raw.sliderMax);
      if (
        !Number.isFinite(sliderMin) ||
        !Number.isFinite(sliderMax) ||
        sliderMax <= sliderMin
      ) {
        return { error: 'INVALID_SLIDER_RANGE' };
      }
      const rawStep = Number(raw.sliderStep);
      const sliderStep =
        Number.isFinite(rawStep) && rawStep > 0 && rawStep <= sliderMax - sliderMin
          ? rawStep
          : 1;
      const sliderUnit =
        typeof raw.sliderUnit === 'string'
          ? raw.sliderUnit.trim().slice(0, 16)
          : '';

      questionObj.sliderMin = sliderMin;
      questionObj.sliderMax = sliderMax;
      questionObj.sliderStep = sliderStep;
      questionObj.sliderUnit = sliderUnit;

      if (scored) {
        const sliderCorrect = Number(raw.sliderCorrect);
        if (
          !Number.isFinite(sliderCorrect) ||
          sliderCorrect < sliderMin ||
          sliderCorrect > sliderMax
        ) {
          return { error: 'INVALID_SLIDER_CORRECT' };
        }
        const rawTolerance = Number(raw.sliderTolerance);
        const sliderTolerance =
          Number.isFinite(rawTolerance) && rawTolerance >= 0
            ? Math.min(rawTolerance, sliderMax - sliderMin)
            : 0;
        questionObj.sliderCorrect = sliderCorrect;
        questionObj.sliderTolerance = sliderTolerance;
      }
    } else if (type === 'word_cloud') {
      const rawMaxLen = Number(raw.maxLength);
      questionObj.maxLength = Number.isFinite(rawMaxLen)
        ? Math.min(80, Math.max(10, Math.round(rawMaxLen)))
        : 32;
    }

    normalized.push(questionObj);
  }

  return { mode, questions: normalized };
}

// ==========================================
// REST API — UWIERZYTELNIANIE I ADMINISTRACJA
// ==========================================

const requireAuth = createRequireAuth(redis);
const requireCsrf = createRequireCsrf(ALLOWED_ORIGINS);
const PORT = Number(process.env.PORT) || 3001;

let webauthnConfig;
try {
  webauthnConfig = getWebAuthnConfig({
    allowedOrigins: ALLOWED_ORIGINS,
    isProd: IS_PROD,
    port: PORT,
  });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

app.use(
  '/api/auth/mfa',
  createMfaRouter({
    pool,
    redis,
    allowedOrigins: ALLOWED_ORIGINS,
    webauthnConfig,
  })
);
app.use(
  '/api/auth',
  createAuthRouter({
    pool,
    redis,
    allowedOrigins: ALLOWED_ORIGINS,
    webauthnConfig,
  })
);
app.use(
  '/api/admin',
  createAdminRouter({ pool, redis, allowedOrigins: ALLOWED_ORIGINS })
);

// ==========================================
// REST API — EDYTOR QUIZÓW (PostgreSQL + izolacja per admin)
// ==========================================

app.get('/api/quizzes', requireAuth, async (req, res) => {
  try {
    const list = await listQuizzesForUser(pool, req.user);
    res.json(list);
  } catch (err) {
    console.error('[QUIZ_LIST_ERROR]', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.get('/api/quizzes/:id', requireAuth, async (req, res) => {
  try {
    const quiz = await getQuizByIdForUser(pool, req.params.id, req.user);
    if (!quiz) return res.status(404).json({ error: 'QUIZ_NOT_FOUND' });
    res.json(quiz);
  } catch (err) {
    console.error('[QUIZ_GET_ERROR]', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.post('/api/quizzes', requireAuth, requireCsrf, async (req, res) => {
  try {
    const title =
      typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 160) : '';
    if (!title) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    }
    const requestedMode = req.body?.mode || 'quiz';
    if (!VALID_MODES.has(requestedMode)) {
      return res.status(400).json({ error: 'INVALID_MODE' });
    }
    const result = normalizeAndValidateQuestions(
      req.body?.questions,
      requestedMode
    );
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const newQuiz = await createQuiz(pool, req.user, {
      title,
      mode: result.mode,
      questions: result.questions,
    });

    const meta = extractReqMeta(req);
    await logAudit(pool, {
      actorId: req.user.id,
      actorName: req.user.username,
      eventType: 'QUIZ_CREATED',
      targetId: newQuiz.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      status: 'SUCCESS',
      metadata: { title: newQuiz.title, mode: newQuiz.mode },
    });

    res.status(201).json(newQuiz);
  } catch (err) {
    console.error('[QUIZ_CREATE_ERROR]', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Klonowanie szablonu lub własnego quizu do edytowalnej kopii bieżącego admina
app.post('/api/quizzes/:id/clone', requireAuth, requireCsrf, async (req, res) => {
  try {
    const cloned = await cloneQuiz(pool, req.params.id, req.user);
    if (!cloned) {
      return res.status(404).json({ error: 'QUIZ_NOT_FOUND' });
    }

    const meta = extractReqMeta(req);
    await logAudit(pool, {
      actorId: req.user.id,
      actorName: req.user.username,
      eventType: 'QUIZ_CLONED',
      targetId: cloned.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      status: 'SUCCESS',
      metadata: { sourceId: req.params.id, title: cloned.title },
    });

    res.status(201).json(cloned);
  } catch (err) {
    console.error('[QUIZ_CLONE_ERROR]', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Aktualizacja istniejącego quizu (tylko właściciel; szablony tylko superadmin)
app.put('/api/quizzes/:id', requireAuth, requireCsrf, async (req, res) => {
  try {
    const title =
      typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 160) : '';
    if (!title) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    }
    const requestedMode = req.body?.mode || 'quiz';
    if (!VALID_MODES.has(requestedMode)) {
      return res.status(400).json({ error: 'INVALID_MODE' });
    }
    const result = normalizeAndValidateQuestions(
      req.body?.questions,
      requestedMode
    );
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const updated = await updateQuiz(pool, req.params.id, req.user, {
      title,
      mode: result.mode,
      questions: result.questions,
    });
    if (updated.error) {
      return res.status(updated.status || 400).json({ error: updated.error });
    }

    const meta = extractReqMeta(req);
    await logAudit(pool, {
      actorId: req.user.id,
      actorName: req.user.username,
      eventType: 'QUIZ_UPDATED',
      targetId: updated.quiz.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      status: 'SUCCESS',
      metadata: { title: updated.quiz.title, mode: updated.quiz.mode },
    });

    res.json(updated.quiz);
  } catch (err) {
    console.error('[QUIZ_UPDATE_ERROR]', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Usunięcie quizu (tylko właściciel lub superadmin; szablony chronione)
app.delete('/api/quizzes/:id', requireAuth, requireCsrf, async (req, res) => {
  try {
    const deleted = await deleteQuiz(pool, req.params.id, req.user);
    if (deleted.error) {
      return res.status(deleted.status || 400).json({ error: deleted.error });
    }

    const meta = extractReqMeta(req);
    await logAudit(pool, {
      actorId: req.user.id,
      actorName: req.user.username,
      eventType: 'QUIZ_DELETED',
      targetId: req.params.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      status: 'SUCCESS',
      metadata: { title: deleted.title },
    });

    res.json({ message: 'QUIZ_DELETED' });
  } catch (err) {
    console.error('[QUIZ_DELETE_ERROR]', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ==========================================
// HEALTHCHECK & SERWOWANIE FRONTENDU (PROD)
// ==========================================

app.get('/health', async (_req, res) => {
  try {
    await Promise.all([redis.ping(), pool.query('SELECT 1')]);
    res.status(200).json({ status: 'ok', redis: 'ready', postgres: 'ready' });
  } catch (_err) {
    res.status(503).json({ status: 'degraded' });
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

function buildHostQuestionPayload(
  question,
  qIndex,
  totalQuestions,
  totalPlayers,
  quizMode,
  includeAnswers = true
) {
  const type = resolveQuestionType(question);
  const scored = resolveQuestionScored(question, quizMode);
  const payload = {
    qIndex,
    totalQuestions,
    type,
    scored,
    sessionMode: quizMode,
    content: question.content || '',
    image: question.image || null,
    timeLimit: question.timeLimit,
    totalPlayers,
  };

  if (type === 'slider') {
    payload.sliderMin = question.sliderMin;
    payload.sliderMax = question.sliderMax;
    payload.sliderStep = question.sliderStep;
    payload.sliderUnit = question.sliderUnit || '';
  } else if (type === 'word_cloud') {
    payload.maxLength = question.maxLength || 32;
  }

  if (includeAnswers && Array.isArray(question.answers)) {
    payload.answers = question.answers;
    payload.answerImages = question.answerImages || [];
  }

  return payload;
}

function computeSliderStats(rawValues, question, scored) {
  const sliderMin = Number(question.sliderMin ?? 0);
  const sliderMax = Number(question.sliderMax ?? 100);
  const sliderStep = Number(question.sliderStep ?? 1);
  const sliderUnit = question.sliderUnit || '';

  const nums = rawValues
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const count = nums.length;
  const avg =
    count > 0
      ? Number((nums.reduce((s, n) => s + n, 0) / count).toFixed(2))
      : null;
  let median = null;
  if (count > 0) {
    const mid = Math.floor(count / 2);
    median =
      count % 2 === 1
        ? nums[mid]
        : Number(((nums[mid - 1] + nums[mid]) / 2).toFixed(2));
  }
  const min = count > 0 ? nums[0] : null;
  const max = count > 0 ? nums[count - 1] : null;

  const span = Math.max(1e-9, sliderMax - sliderMin);
  const discreteSteps = Math.round(span / Math.max(sliderStep, 1e-9)) + 1;
  const binCount =
    Number.isInteger(discreteSteps) && discreteSteps >= 2 && discreteSteps <= 12
      ? discreteSteps
      : 10;

  const bins = Array.from({ length: binCount }, (_, idx) => {
    const from = sliderMin + (idx * span) / binCount;
    const to = sliderMin + ((idx + 1) * span) / binCount;
    return {
      from: Number(from.toFixed(2)),
      to: Number(to.toFixed(2)),
      count: 0,
    };
  });

  for (const val of nums) {
    const ratio = (val - sliderMin) / span;
    const bIdx = Math.min(binCount - 1, Math.max(0, Math.floor(ratio * binCount)));
    bins[bIdx].count++;
  }

  return {
    count,
    avg,
    median,
    min,
    max,
    bins,
    sliderMin,
    sliderMax,
    sliderStep,
    sliderUnit,
    correctValue: scored ? Number(question.sliderCorrect) : null,
    tolerance: scored ? Number(question.sliderTolerance ?? 0) : 0,
  };
}

function computeWordCloud(rawValues) {
  const groups = new Map();
  let totalResponses = 0;

  for (const raw of rawValues) {
    const clean = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    totalResponses++;
    const key = clean.toLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        count: 1,
        variants: new Map([[clean, 1]]),
      });
    } else {
      existing.count++;
      existing.variants.set(clean, (existing.variants.get(clean) || 0) + 1);
    }
  }

  const entries = Array.from(groups.values())
    .map((group) => {
      // Wybierz najczęstszą pisownię danego hasła
      let displayWord = '';
      let bestCount = -1;
      for (const [variant, vCount] of group.variants.entries()) {
        if (vCount > bestCount) {
          bestCount = vCount;
          displayWord = variant;
        }
      }
      return { word: displayWord, count: group.count };
    })
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  return {
    entries: entries.slice(0, 60),
    uniqueCount: entries.length,
    totalResponses,
  };
}

async function getSessionSummaries(pin, quiz) {
  const raw = await redis.hgetall(`room:${pin}:summaries`);
  const list = [];
  const totalQ = quiz?.questions?.length || 0;
  for (let i = 0; i < totalQ; i++) {
    if (raw && raw[String(i)]) {
      try {
        list.push(JSON.parse(raw[String(i)]));
      } catch (_err) {
        // skip corrupted summary
      }
    }
  }
  return list;
}

async function buildRoomSnapshot(pin) {
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || !state.status) {
    return { error: 'ROOM_NOT_FOUND' };
  }

  const quiz = await getActiveRoomQuiz(pin, state.quiz_id);
  const sessionMode = quiz?.mode || state.quiz_mode || 'quiz';
  const hasScoredQuestions = quizHasScoredQuestions(quiz);
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
    sessionMode,
    hasScoredQuestions,
    totalQuestions: quiz?.questions.length || 0,
    players: fullResults.map((p) => p.nickname),
    autoAdvanceEnabled: state.auto_advance_enabled !== '0',
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
        ...buildHostQuestionPayload(
          question,
          qIndex,
          quiz.questions.length,
          totalPlayers,
          sessionMode,
          false
        ),
        previewDuration: QUESTION_PREVIEW_SECONDS,
        previewRemaining: +(remainingMs / 1000).toFixed(1),
      },
    };
  }

  if (state.status === 'QUESTION' && quiz && quiz.questions[qIndex]) {
    const question = quiz.questions[qIndex];
    const currentCount = await redis.hlen(`room:${pin}:answers:${qIndex}`);
    const hasLimit = Number(question.timeLimit) > 0;
    return {
      ...base,
      currentQuestion: buildHostQuestionPayload(
        question,
        qIndex,
        quiz.questions.length,
        totalPlayers,
        sessionMode,
        true
      ),
      timeLeft: hasLimit ? +(remainingMs / 1000).toFixed(1) : 0,
      answerCount: { count: currentCount, total: totalPlayers },
    };
  }

  if (state.status === 'LEADERBOARD' && quiz && quiz.questions[qIndex]) {
    const question = quiz.questions[qIndex];
    let savedResult = {};
    try {
      if (state.last_round_result) {
        savedResult = JSON.parse(state.last_round_result);
      }
    } catch (_err) {
      // fallback empty
    }
    const autoAdvanceEnabled = state.auto_advance_enabled !== '0';
    const isPaused = autoAdvanceEnabled && state.auto_next_paused === '1';
    const qType = resolveQuestionType(question);
    const scored = resolveQuestionScored(question, sessionMode);

    return {
      ...base,
      currentQuestion: buildHostQuestionPayload(
        question,
        qIndex,
        quiz.questions.length,
        totalPlayers,
        sessionMode,
        true
      ),
      leaderboardData: {
        qIndex,
        questionType: qType,
        scored,
        sessionMode,
        correctIndex:
          qType === 'abcd' || qType === 'true_false'
            ? Number(state.correct_index)
            : null,
        distribution: savedResult.distribution || null,
        sliderStats: savedResult.sliderStats || null,
        wordCloud: savedResult.wordCloud || null,
        uniqueCount: savedResult.uniqueCount || 0,
        totalResponses: savedResult.totalResponses || 0,
        topPlayers: scored ? fullResults.slice(0, 5) : [],
        autoNextIn: !autoAdvanceEnabled || isPaused ? 0 : Math.ceil(remainingMs / 1000),
        isLastQuestion: qIndex + 1 >= quiz.questions.length,
        isPaused,
        autoAdvanceEnabled,
      },
    };
  }

  if (state.status === 'PODIUM') {
    const questionSummaries = await getSessionSummaries(pin, quiz);
    return {
      ...base,
      podium: fullResults.slice(0, 3),
      allResults: fullResults,
      questionSummaries,
    };
  }

  return base;
}

// Faza 1 rundy: Podgląd samego pytania przez 5 sekund przed ujawnieniem odpowiedzi
async function startQuestionPreview(pin, qIndex) {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || !state.quiz_id || state.status === 'ABORTED') return;

  const quiz = await getActiveRoomQuiz(pin, state.quiz_id);
  if (!quiz || qIndex >= quiz.questions.length) {
    return finishQuiz(pin);
  }

  const sessionMode = quiz.mode || 'quiz';
  const question = quiz.questions[qIndex];
  const qType = resolveQuestionType(question);
  const scored = resolveQuestionScored(question, sessionMode);
  const now = Date.now();
  const previewDurationMs = QUESTION_PREVIEW_SECONDS * 1000;

  // Jeśli wracamy do już rozegranego pytania, odejmij punkty zdobyte wcześniej w tej rundzie
  const prevEarned = await redis.hgetall(`room:${pin}:earned:${qIndex}`);
  if (prevEarned) {
    for (const [nick, pts] of Object.entries(prevEarned)) {
      const numPts = Number(pts);
      if (numPts > 0) {
        await redis.zincrby(`room:${pin}:leaderboard`, -numPts, nick);
      }
    }
  }

  // Wyczyść odpowiedzi dla tego indeksu pytania
  await redis.del(`room:${pin}:answers:${qIndex}`);
  await redis.del(`room:${pin}:earned:${qIndex}`);

  await redis.hmset(`room:${pin}:state`, {
    status: 'QUESTION_PREVIEW',
    quiz_mode: sessionMode,
    current_q_index: qIndex,
    current_q_type: qType,
    current_q_scored: scored ? '1' : '0',
    phase_start_timestamp: now,
    phase_duration_ms: previewDurationMs,
    correct_index:
      question.correctIndex !== undefined ? String(question.correctIndex) : '-1',
    auto_next_paused: '0',
  });

  const totalPlayers = await redis.zcard(`room:${pin}:leaderboard`);

  // Do Hosta i Ekranu gry wysyłamy treść pytania + odliczanie do ujawnienia odpowiedzi
  io.to(`host:${pin}`).emit('host_question_preview', {
    ...buildHostQuestionPayload(
      question,
      qIndex,
      quiz.questions.length,
      totalPlayers,
      sessionMode,
      false
    ),
    previewDuration: QUESTION_PREVIEW_SECONDS,
  });

  // Do Graczy (Smartfony) wysyłamy sygnał podglądu pytania (kontrolki jeszcze zablokowane)
  io.to(`players:${pin}`).emit('player_question_preview', {
    qIndex,
    totalQuestions: quiz.questions.length,
    previewDuration: QUESTION_PREVIEW_SECONDS,
    questionType: qType,
    scored,
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

  const quiz = await getActiveRoomQuiz(pin, state.quiz_id);
  if (!quiz || !quiz.questions[qIndex]) {
    return finishQuiz(pin);
  }

  const sessionMode = quiz.mode || 'quiz';
  const question = quiz.questions[qIndex];
  const qType = resolveQuestionType(question);
  const scored = resolveQuestionScored(question, sessionMode);
  const now = Date.now();
  const hasTimeLimit = Number(question.timeLimit) > 0;
  const timeLimitMs = hasTimeLimit ? question.timeLimit * 1000 : 0;

  // Zapisz stan aktywnego pytania w Redisie (punktacja liczona od ujawnienia odpowiedzi!)
  await redis.hmset(`room:${pin}:state`, {
    status: 'QUESTION',
    quiz_mode: sessionMode,
    current_q_index: qIndex,
    current_q_type: qType,
    current_q_scored: scored ? '1' : '0',
    question_start_timestamp: now,
    phase_start_timestamp: now,
    phase_duration_ms: timeLimitMs,
    time_limit_ms: timeLimitMs,
    correct_index:
      question.correctIndex !== undefined ? String(question.correctIndex) : '-1',
  });

  const totalPlayers = await redis.zcard(`room:${pin}:leaderboard`);

  // 1. Do Hosta i Ekranu gry (Rzutnik) wysyłamy pełną treść pytania z opcjami
  io.to(`host:${pin}`).emit(
    'host_question_start',
    buildHostQuestionPayload(
      question,
      qIndex,
      quiz.questions.length,
      totalPlayers,
      sessionMode,
      true
    )
  );

  // 2. Do Graczy (Smartfony) wysyłamy lekki sygnał odblokowania kontrolek (kilkadziesiąt bajtów)
  const playerPayload = {
    qIndex,
    questionType: qType,
    scored,
    timeLimit: question.timeLimit,
  };
  if (qType === 'abcd' || qType === 'poll') {
    playerPayload.optionsCount = question.answers.length;
  } else if (qType === 'true_false') {
    playerPayload.optionsCount = 2;
    playerPayload.labels = question.answers;
  } else if (qType === 'slider') {
    playerPayload.sliderMin = question.sliderMin;
    playerPayload.sliderMax = question.sliderMax;
    playerPayload.sliderStep = question.sliderStep;
    playerPayload.sliderUnit = question.sliderUnit || '';
  } else if (qType === 'word_cloud') {
    playerPayload.maxLength = question.maxLength || 32;
  }
  io.to(`players:${pin}`).emit('player_question_start', playerPayload);

  let lastBroadcastCount = 0;
  let lastBroadcastTotal = totalPlayers;

  // Throttling: wysyłanie liczby odpowiedzi do hosta i ekranu maksymalnie raz na 250 ms
  const throttleInterval = setInterval(async () => {
    try {
      const [currentCount, liveTotalPlayers] = await Promise.all([
        redis.hlen(`room:${pin}:answers:${qIndex}`),
        redis.zcard(`room:${pin}:leaderboard`),
      ]);
      if (
        currentCount !== lastBroadcastCount ||
        liveTotalPlayers !== lastBroadcastTotal
      ) {
        lastBroadcastCount = currentCount;
        lastBroadcastTotal = liveTotalPlayers;
        io.to(`host:${pin}`).emit('answer_count_update', {
          count: currentCount,
          total: liveTotalPlayers,
        });
      }
      // Jeśli wszyscy gracze odpowiedzieli, kończymy pytanie przed czasem
      if (liveTotalPlayers > 0 && currentCount >= liveTotalPlayers) {
        endQuestion(pin, qIndex);
      }
    } catch (_err) {
      // ignore redis errors during throttle
    }
  }, 250);

  // Główny timer pytania — automatyczne zakończenie po upływie czasu (gdy ustawiono limit)
  const questionTimer = hasTimeLimit
    ? setTimeout(() => {
        endQuestion(pin, qIndex);
      }, timeLimitMs)
    : null;

  roomTimers.set(pin, { questionTimer, throttleInterval });
}

async function endQuestion(pin, qIndex) {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || state.status !== 'QUESTION') return;

  const quiz = await getActiveRoomQuiz(pin, state.quiz_id);
  if (!quiz || !quiz.questions[qIndex]) return;

  const sessionMode = quiz.mode || 'quiz';
  const question = quiz.questions[qIndex];
  const qType = resolveQuestionType(question);
  const scored = resolveQuestionScored(question, sessionMode);
  const correctIndex =
    qType === 'abcd' || qType === 'true_false'
      ? Number(question.correctIndex)
      : null;

  const rawAnswers = await redis.hgetall(`room:${pin}:answers:${qIndex}`);
  const rawValues = Object.values(rawAnswers);
  const totalResponses = rawValues.length;

  let distribution = null;
  let sliderStats = null;
  let wordCloud = null;
  let uniqueCount = 0;

  if (qType === 'abcd' || qType === 'true_false' || qType === 'poll') {
    const optCount = question.answers.length;
    distribution = new Array(optCount).fill(0);
    rawValues.forEach((ans) => {
      const idx = Number(ans);
      if (Number.isInteger(idx) && idx >= 0 && idx < optCount) {
        distribution[idx]++;
      }
    });
  } else if (qType === 'slider') {
    sliderStats = computeSliderStats(rawValues, question, scored);
  } else if (qType === 'word_cloud') {
    const wc = computeWordCloud(rawValues);
    wordCloud = wc.entries;
    uniqueCount = wc.uniqueCount;
  }

  const savedResult = {
    distribution,
    sliderStats,
    wordCloud,
    uniqueCount,
    totalResponses,
  };

  // Zapisz zwięzłe podsumowanie rundy (do ekranu końcowego dla trybu opinii)
  const roundSummary = {
    qIndex,
    type: qType,
    scored,
    content: question.content || '(Pytanie ze zdjęciem)',
    totalResponses,
  };
  if (qType === 'poll' || qType === 'abcd' || qType === 'true_false') {
    roundSummary.answers = question.answers;
    roundSummary.distribution = distribution;
  } else if (qType === 'slider' && sliderStats) {
    roundSummary.avg = sliderStats.avg;
    roundSummary.median = sliderStats.median;
    roundSummary.sliderUnit = sliderStats.sliderUnit;
  } else if (qType === 'word_cloud' && wordCloud) {
    roundSummary.topWords = wordCloud.slice(0, 6);
    roundSummary.uniqueCount = uniqueCount;
  }
  await redis.hset(
    `room:${pin}:summaries`,
    String(qIndex),
    JSON.stringify(roundSummary)
  );
  await redis.expire(`room:${pin}:summaries`, 7200);

  const now = Date.now();
  await redis.hmset(`room:${pin}:state`, {
    status: 'LEADERBOARD',
    phase_start_timestamp: now,
    phase_duration_ms: AUTO_NEXT_SECONDS * 1000,
    auto_next_paused: '0',
    last_round_result: JSON.stringify(savedResult),
  });

  // Pobranie Top 5 z Redis Sorted Set (dla pytań punktowanych)
  let topPlayers = [];
  if (scored) {
    const topRaw = await redis.zrevrange(
      `room:${pin}:leaderboard`,
      0,
      4,
      'WITHSCORES'
    );
    for (let i = 0; i < topRaw.length; i += 2) {
      topPlayers.push({
        nickname: topRaw[i],
        score: Number(topRaw[i + 1]),
      });
    }
  }

  const isLastQuestion = qIndex + 1 >= quiz.questions.length;

  // Wysłanie wyników rundy do Hosta i Ekranu gry
  const autoAdvEnabled = state.auto_advance_enabled !== '0';
  io.to(`host:${pin}`).emit('host_question_end', {
    qIndex,
    questionType: qType,
    scored,
    sessionMode,
    correctIndex,
    distribution,
    sliderStats,
    wordCloud,
    uniqueCount,
    totalResponses,
    topPlayers,
    autoNextIn: autoAdvEnabled ? AUTO_NEXT_SECONDS : 0,
    isLastQuestion,
    isPaused: false,
    autoAdvanceEnabled: autoAdvEnabled,
  });

  // Wysłanie indywidualnego statusu do każdego gracza
  const sockets = await io.in(`players:${pin}`).fetchSockets();
  for (const s of sockets) {
    const nickname = s.data.nickname;
    if (!nickname) continue;

    const score = await redis.zscore(`room:${pin}:leaderboard`, nickname);
    const rank = await redis.zrevrank(`room:${pin}:leaderboard`, nickname);
    const playerAnswer = rawAnswers[s.id];
    const submitted = playerAnswer !== undefined;

    if (!scored) {
      let submittedDisplay = null;
      if (submitted) {
        if (qType === 'poll') {
          const aIdx = Number(playerAnswer);
          const optLetter = ['A', 'B', 'C', 'D'][aIdx] || '?';
          const optText = question.answers?.[aIdx];
          submittedDisplay = optText ? `${optLetter} (${optText})` : optLetter;
        } else if (qType === 'slider') {
          submittedDisplay = `${playerAnswer}${
            question.sliderUnit ? ` ${question.sliderUnit}` : ''
          }`;
        } else if (qType === 'word_cloud') {
          submittedDisplay = `„${playerAnswer}”`;
        }
      }

      s.emit('player_question_end', {
        questionType: qType,
        scored: false,
        sessionMode,
        submitted,
        submittedDisplay,
        score: Number(score || 0),
        rank: rank !== null ? rank + 1 : null,
      });
      continue;
    }

    const earnedPoints = Number(
      (await redis.hget(`room:${pin}:earned:${qIndex}`, nickname)) || 0
    );

    let isCorrect = false;
    if (qType === 'abcd' || qType === 'true_false') {
      isCorrect = submitted && Number(playerAnswer) === correctIndex;
    } else if (qType === 'slider') {
      isCorrect = earnedPoints > 0;
    }

    const playerEndPayload = {
      questionType: qType,
      scored: true,
      sessionMode,
      isCorrect,
      earnedPoints,
      correctIndex,
      score: Number(score || 0),
      rank: rank !== null ? rank + 1 : null,
    };

    if (qType === 'slider') {
      playerEndPayload.correctValue = Number(question.sliderCorrect);
      playerEndPayload.tolerance = Number(question.sliderTolerance ?? 0);
      playerEndPayload.sliderUnit = question.sliderUnit || '';
      playerEndPayload.submittedValue = submitted ? Number(playerAnswer) : null;
    }

    s.emit('player_question_end', playerEndPayload);
  }

  // Automatyczne przełączenie do kolejnego pytania (podgląd) po 6 sekundach
  // — tylko jeśli auto-advance jest włączone
  const autoAdvanceEnabled = state.auto_advance_enabled !== '0';
  if (autoAdvanceEnabled) {
    const autoNextTimer = setTimeout(() => {
      startQuestionPreview(pin, qIndex + 1);
    }, AUTO_NEXT_SECONDS * 1000);

    roomTimers.set(pin, { autoNextTimer });
  }
}

async function finishQuiz(pin) {
  clearRoomTimers(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || state.status === 'ABORTED') return;

  const quiz = await getActiveRoomQuiz(pin, state.quiz_id);
  const sessionMode = quiz?.mode || state.quiz_mode || 'quiz';
  const hasScoredQuestions = quizHasScoredQuestions(quiz);

  await redis.hset(`room:${pin}:state`, 'status', 'PODIUM');

  // Pełna tabela wyników + Top 3 na podium z Redis ZSET + podsumowanie rund
  const allResults = await getFullLeaderboard(pin);
  const podium = allResults.slice(0, 3);
  const questionSummaries = await getSessionSummaries(pin, quiz);

  io.to(`host:${pin}`).emit('host_podium', {
    podium,
    allResults,
    sessionMode,
    hasScoredQuestions,
    questionSummaries,
  });

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
      sessionMode,
      hasScoredQuestions,
    });
  }
}

async function abortGame(pin, reason = 'HOST_ABORTED') {
  clearRoomTimers(pin);
  roomQuizCache.delete(pin);
  const state = await redis.hgetall(`room:${pin}:state`);
  if (!state || !state.status) return;

  await redis.hset(`room:${pin}:state`, 'status', 'ABORTED');

  io.to(`host:${pin}`).emit('game_aborted', { reason });
  io.to(`players:${pin}`).emit('game_aborted', { reason });
}

// ==========================================
// WERYFIKACJA SESJI HOSTA W SOCKET.IO (OWASP ASVS V3 / V4)
// ==========================================

async function assertHostSession(socket) {
  if (!socket.data.user || !socket.data.sidHash) {
    return null;
  }
  const found = await getSessionByHash(redis, socket.data.sidHash, {
    touch: true,
  });
  if (
    !found ||
    !found.session.mfaVerified ||
    found.session.mustChangePassword
  ) {
    socket.data.user = null;
    socket.data.sidHash = null;
    return null;
  }
  return {
    id: found.session.userId,
    username: found.session.username,
    role: found.session.role,
  };
}

async function assertRoomOwner(socket, pin) {
  const user = await assertHostSession(socket);
  if (!user) {
    return { error: 'UNAUTHORIZED' };
  }
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) {
    return { error: 'MISSING_PIN' };
  }
  const state = await redis.hgetall(`room:${cleanPin}:state`);
  if (!state || !state.status) {
    return { error: 'ROOM_NOT_FOUND' };
  }
  if (
    state.owner_id &&
    state.owner_id !== user.id &&
    user.role !== 'superadmin'
  ) {
    return { error: 'FORBIDDEN' };
  }
  return { user, state, pin: cleanPin };
}

// ==========================================
// OBSŁUGA POŁĄCZEŃ WEBSOCKET
// ==========================================

io.on('connection', (socket) => {
  // 1. Host (Panel prowadzącego) tworzy pokój — wymaga ważnej sesji admina
  socket.on('host_create_room', async ({ quizId } = {}, callback) => {
    try {
      const user = await assertHostSession(socket);
      if (!user) {
        return callback?.({ error: 'UNAUTHORIZED' });
      }

      const targetQuizId = quizId || DEFAULT_QUIZ_ID;
      const quiz = await getQuizByIdForUser(pool, targetQuizId, user);
      if (!quiz) return callback?.({ error: 'QUIZ_NOT_FOUND' });

      // Jeśli ten kontroler był wcześniej w innym pokoju, opuść stare pokoje
      if (socket.data.pin && socket.data.isController) {
        socket.leave(`host:${socket.data.pin}`);
        socket.leave(`controller:${socket.data.pin}`);
      }

      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      const quizMode = quiz.mode || 'quiz';
      const quizSnapshot = {
        id: quiz.id,
        title: quiz.title,
        mode: quizMode,
        questions: quiz.questions,
      };

      await redis.del(`room:${pin}:leaderboard`);
      await redis.del(`room:${pin}:summaries`);
      await redis.set(
        `room:${pin}:quiz`,
        JSON.stringify(quizSnapshot),
        'EX',
        7200
      );
      roomQuizCache.set(pin, quizSnapshot);

      await redis.hmset(`room:${pin}:state`, {
        status: 'LOBBY',
        quiz_id: targetQuizId,
        quiz_mode: quizMode,
        owner_id: user.id,
        owner_name: user.username,
        current_q_index: -1,
        host_socket_id: socket.id,
        auto_next_paused: '0',
        auto_advance_enabled: '1',
      });
      // TTL na klucze pokoju (2 godziny)
      await redis.expire(`room:${pin}:state`, 7200);

      socket.join(`host:${pin}`);
      socket.join(`controller:${pin}`);
      socket.data.pin = pin;
      socket.data.isHost = true;
      socket.data.isController = true;

      await logAudit(pool, {
        actorId: user.id,
        actorName: user.username,
        eventType: 'GAME_ROOM_CREATED',
        targetId: pin,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers?.['user-agent'] || null,
        status: 'SUCCESS',
        metadata: { quizId: quiz.id, quizTitle: quiz.title },
      });

      callback?.({ pin, quiz: quizSnapshot });
    } catch (err) {
      console.error('[HOST_CREATE_ROOM_ERROR]', err.message);
      callback?.({ error: 'SERVER_ERROR' });
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
  //    — dozwolone zarówno w LOBBY jak i w trakcie trwania gry
  socket.on('player_join', async ({ pin, nickname }, callback) => {
    try {
      const cleanNick = (nickname || '').trim().toUpperCase().slice(0, 16);
      if (!cleanNick) return callback({ error: 'INVALID_NICKNAME' });

      const cleanPin = String(pin || '').trim();
      if (!cleanPin) return callback({ error: 'MISSING_PIN' });

      const state = await redis.hgetall(`room:${cleanPin}:state`);
      if (!state || !state.status)
        return callback({ error: 'ROOM_NOT_FOUND' });
      if (state.status === 'ABORTED' || state.status === 'PODIUM')
        return callback({ error: 'GAME_ALREADY_FINISHED' });

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

      // Jeśli gra jest w trakcie, przygotuj aktualny stan rozgrywki dla gracza
      let gameState = { status: state.status };

      if (state.status !== 'LOBBY') {
        const qIndex = Number(state.current_q_index ?? -1);
        const quiz = await getActiveRoomQuiz(cleanPin, state.quiz_id);

        if (state.status === 'COUNTDOWN') {
          const now = Date.now();
          const phaseStart = Number(state.phase_start_timestamp || 0);
          const phaseDuration = Number(state.phase_duration_ms || 0);
          const remainingMs = Math.max(0, phaseDuration - (now - phaseStart));
          gameState = {
            status: 'COUNTDOWN',
            payload: {
              seconds: Math.max(1, Math.ceil(remainingMs / 1000)),
            },
          };
        } else if (
          state.status === 'QUESTION_PREVIEW' &&
          quiz &&
          quiz.questions[qIndex]
        ) {
          const question = quiz.questions[qIndex];
          const qType = resolveQuestionType(question);
          const scored = resolveQuestionScored(question, quiz.mode || 'quiz');
          const now = Date.now();
          const phaseStart = Number(state.phase_start_timestamp || 0);
          const phaseDuration = Number(state.phase_duration_ms || 0);
          const remainingMs = Math.max(0, phaseDuration - (now - phaseStart));
          gameState = {
            status: 'QUESTION_PREVIEW',
            payload: {
              qIndex,
              totalQuestions: quiz.questions.length,
              previewDuration: QUESTION_PREVIEW_SECONDS,
              previewRemaining: +(remainingMs / 1000).toFixed(1),
              questionType: qType,
              scored,
            },
          };
        } else if (
          state.status === 'QUESTION' &&
          quiz &&
          quiz.questions[qIndex]
        ) {
          const question = quiz.questions[qIndex];
          const qType = resolveQuestionType(question);
          const scored = resolveQuestionScored(question, quiz.mode || 'quiz');
          const now = Date.now();
          const phaseStart = Number(state.phase_start_timestamp || 0);
          const phaseDuration = Number(state.phase_duration_ms || 0);
          const remainingMs = Math.max(0, phaseDuration - (now - phaseStart));
          const hasTimeLimit = Number(question.timeLimit) > 0;
          const playerPayload = {
            qIndex,
            questionType: qType,
            scored,
            timeLimit: question.timeLimit,
            timeRemaining: hasTimeLimit ? +(remainingMs / 1000).toFixed(1) : 0,
          };
          if (qType === 'abcd' || qType === 'poll') {
            playerPayload.optionsCount = question.answers.length;
          } else if (qType === 'true_false') {
            playerPayload.optionsCount = 2;
            playerPayload.labels = question.answers;
          } else if (qType === 'slider') {
            playerPayload.sliderMin = question.sliderMin;
            playerPayload.sliderMax = question.sliderMax;
            playerPayload.sliderStep = question.sliderStep;
            playerPayload.sliderUnit = question.sliderUnit || '';
          } else if (qType === 'word_cloud') {
            playerPayload.maxLength = question.maxLength || 32;
          }
          gameState = { status: 'QUESTION', payload: playerPayload };

          // Zaktualizuj licznik uczestników dla bieżącego pytania na hoście i ekranie gry
          const currentCount = await redis.hlen(`room:${cleanPin}:answers:${qIndex}`);
          io.to(`host:${cleanPin}`).emit('answer_count_update', {
            count: currentCount,
            total: totalPlayers,
          });
        } else if (state.status === 'LEADERBOARD') {
          gameState = {
            status: 'LEADERBOARD',
            payload: {
              questionType: state.current_q_type || 'abcd',
              scored: false,
              sessionMode: quiz?.mode || state.quiz_mode || 'quiz',
              submitted: false,
              submittedDisplay: null,
              score: 0,
              rank: totalPlayers,
              lateJoin: true,
            },
          };
        }
      }

      callback({
        success: true,
        pin: cleanPin,
        nickname: cleanNick,
        gameState,
      });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // 3. Host uruchamia grę — krótkie odliczanie startowe, a potem podgląd 1. pytania
  socket.on('host_start_game', async ({ pin } = {}, callback) => {
    const auth = await assertRoomOwner(socket, pin);
    if (auth.error) {
      callback?.({ error: auth.error });
      return socket.emit('host_auth_error', { error: auth.error });
    }
    const { state } = auth;
    if (state.status !== 'LOBBY') return;

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
    callback?.({ success: true });
  });

  // 4. Wymuszenie przejścia dalej przez Hosta (działa w każdej aktywnej fazie)
  socket.on('host_force_next', async ({ pin } = {}, callback) => {
    const auth = await assertRoomOwner(socket, pin);
    if (auth.error) {
      callback?.({ error: auth.error });
      return socket.emit('host_auth_error', { error: auth.error });
    }
    const { state } = auth;
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
    callback?.({ success: true });
  });

  // 4b. Wstrzymanie / wznowienie automatycznego przejścia po wynikach rundy
  socket.on('host_toggle_pause', async ({ pin } = {}, callback) => {
    const auth = await assertRoomOwner(socket, pin);
    if (auth.error) {
      callback?.({ error: auth.error });
      return socket.emit('host_auth_error', { error: auth.error });
    }
    const { state } = auth;
    if (state.status !== 'LEADERBOARD' || state.auto_advance_enabled === '0') {
      return callback?.({ success: false });
    }

    const currentIdx = Number(state.current_q_index);
    const isCurrentlyPaused = state.auto_next_paused === '1';

    if (!isCurrentlyPaused) {
      clearRoomTimers(pin);
      await redis.hset(`room:${pin}:state`, 'auto_next_paused', '1');
      io.to(`host:${pin}`).emit('host_auto_next_status', {
        isPaused: true,
        autoNextIn: 0,
        autoAdvanceEnabled: true,
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
        autoAdvanceEnabled: true,
      });
      const autoNextTimer = setTimeout(() => {
        startQuestionPreview(pin, currentIdx + 1);
      }, AUTO_NEXT_SECONDS * 1000);
      roomTimers.set(pin, { autoNextTimer });
    }
    callback?.({ success: true });
  });

  // 4b2. Włączanie/wyłączanie automatycznego przełączania pytań przez prowadzącego
  socket.on('host_set_auto_advance', async ({ pin, enabled } = {}, callback) => {
    const auth = await assertRoomOwner(socket, pin);
    if (auth.error) {
      callback?.({ error: auth.error });
      return socket.emit('host_auth_error', { error: auth.error });
    }

    const newEnabled = enabled !== false;
    await redis.hset(`room:${pin}:state`, 'auto_advance_enabled', newEnabled ? '1' : '0');

    // Jeśli wyłączamy auto-advance i jesteśmy w LEADERBOARD, zatrzymaj timer
    const { state } = auth;
    if (!newEnabled && state.status === 'LEADERBOARD') {
      clearRoomTimers(pin);
      await redis.hset(`room:${pin}:state`, 'auto_next_paused', '0');
      io.to(`host:${pin}`).emit('host_auto_next_status', {
        isPaused: false,
        autoNextIn: 0,
        autoAdvanceEnabled: false,
      });
    } else if (newEnabled && state.status === 'LEADERBOARD') {
      // Jeśli włączamy auto-advance, wznów odliczanie
      clearRoomTimers(pin);
      const now = Date.now();
      const currentIdx = Number(state.current_q_index);
      await redis.hmset(`room:${pin}:state`, {
        auto_next_paused: '0',
        phase_start_timestamp: now,
        phase_duration_ms: AUTO_NEXT_SECONDS * 1000,
      });
      io.to(`host:${pin}`).emit('host_auto_next_status', {
        isPaused: false,
        autoNextIn: AUTO_NEXT_SECONDS,
        autoAdvanceEnabled: true,
      });
      const autoNextTimer = setTimeout(() => {
        startQuestionPreview(pin, currentIdx + 1);
      }, AUTO_NEXT_SECONDS * 1000);
      roomTimers.set(pin, { autoNextTimer });
    }

    // Powiadom hosta i ekran gry o zmianie trybu
    io.to(`host:${pin}`).emit('host_auto_advance_changed', {
      autoAdvanceEnabled: newEnabled,
    });

    callback?.({ success: true, autoAdvanceEnabled: newEnabled });
  });

  // 4b3. Ręczne przejście do wybranego pytania (poprzednie / następne)
  socket.on('host_go_to_question', async ({ pin, qIndex } = {}, callback) => {
    const auth = await assertRoomOwner(socket, pin);
    if (auth.error) {
      callback?.({ error: auth.error });
      return socket.emit('host_auth_error', { error: auth.error });
    }

    const { state } = auth;
    if (state.status === 'ABORTED' || state.status === 'PODIUM') {
      return callback?.({ error: 'INVALID_STATE' });
    }

    const targetIdx = Number(qIndex);
    if (!Number.isInteger(targetIdx) || targetIdx < 0) {
      return callback?.({ error: 'INVALID_QUESTION_INDEX' });
    }

    const quiz = await getActiveRoomQuiz(pin, state.quiz_id);
    if (!quiz) {
      return callback?.({ error: 'QUIZ_NOT_FOUND' });
    }

    if (targetIdx >= quiz.questions.length) {
      await finishQuiz(pin);
    } else {
      await startQuestionPreview(pin, targetIdx);
    }
    callback?.({ success: true });
  });

  // 4c. Przerwanie gry przez prowadzącego
  socket.on('host_abort_game', async ({ pin } = {}, callback) => {
    try {
      const auth = await assertRoomOwner(socket, pin);
      if (auth.error) {
        callback?.({ error: auth.error });
        return socket.emit('host_auth_error', { error: auth.error });
      }
      await abortGame(pin, 'HOST_ABORTED');
      if (socket.data.pin === pin) {
        socket.leave(`host:${pin}`);
        socket.leave(`controller:${pin}`);
        socket.data.pin = null;
      }
      await logAudit(pool, {
        actorId: auth.user.id,
        actorName: auth.user.username,
        eventType: 'GAME_ROOM_ABORTED',
        targetId: pin,
        ip: socket.handshake.address,
        status: 'SUCCESS',
      });
      callback?.({ success: true });
    } catch (err) {
      callback?.({ error: 'SERVER_ERROR' });
    }
  });

  // 4d. Zamknięcie sesji po zakończeniu podium (powrót prowadzącego do menu)
  socket.on('host_leave_room', async ({ pin } = {}, callback) => {
    try {
      const auth = await assertRoomOwner(socket, pin);
      if (auth.error) {
        callback?.({ error: auth.error });
        return;
      }
      clearRoomTimers(pin);
      roomQuizCache.delete(pin);
      if (socket.data.pin === pin) {
        socket.leave(`host:${pin}`);
        socket.leave(`controller:${pin}`);
        socket.data.pin = null;
      }
      callback?.({ success: true });
    } catch (err) {
      callback?.({ error: 'SERVER_ERROR' });
    }
  });

  // 5. Odbiór odpowiedzi od gracza w czasie rzeczywistym (wszystkie formy pytań)
  socket.on('submit_answer', async (payload = {}) => {
    try {
      const pin = String(payload.pin || '').trim();
      const { qIndex, answerIndex, value, text } = payload;
      const now = Date.now();
      const state = await redis.hgetall(`room:${pin}:state`);

      if (
        !state ||
        state.status !== 'QUESTION' ||
        Number(state.current_q_index) !== qIndex
      ) {
        return socket.emit('error_msg', 'TIMEOUT_OR_INVALID_STATE');
      }

      const quiz = await getActiveRoomQuiz(pin, state.quiz_id);
      const question = quiz?.questions?.[qIndex];
      if (!quiz || !question) {
        return socket.emit('error_msg', 'INVALID_QUESTION');
      }

      const sessionMode = quiz.mode || state.quiz_mode || 'quiz';
      const qType = resolveQuestionType(question);
      const scored = resolveQuestionScored(question, sessionMode);

      let storedValue;
      let earnedPoints = 0;

      if (qType === 'abcd' || qType === 'true_false' || qType === 'poll') {
        const idx = Number(answerIndex);
        if (
          !Number.isInteger(idx) ||
          idx < 0 ||
          idx >= question.answers.length
        ) {
          return socket.emit('error_msg', 'INVALID_ANSWER');
        }
        storedValue = String(idx);

        if (scored && idx === Number(question.correctIndex)) {
          const timeLimit = Number(state.time_limit_ms);
          if (timeLimit <= 0) {
            earnedPoints = 1000;
          } else {
            const timeElapsed = Math.max(
              0,
              now - Number(state.question_start_timestamp)
            );
            earnedPoints = Math.max(
              500,
              Math.floor(1000 * (1 - timeElapsed / (timeLimit * 2)))
            );
          }
        }
      } else if (qType === 'slider') {
        const numVal = Number(value);
        const min = Number(question.sliderMin);
        const max = Number(question.sliderMax);
        if (!Number.isFinite(numVal) || numVal < min || numVal > max) {
          return socket.emit('error_msg', 'INVALID_SLIDER_VALUE');
        }
        storedValue = String(numVal);

        if (scored) {
          const correctVal = Number(question.sliderCorrect);
          const tol = Math.max(0, Number(question.sliderTolerance ?? 0));
          const diff = Math.abs(numVal - correctVal);
          const isHit = tol === 0 ? diff === 0 : diff <= tol;
          if (isHit) {
            const accuracy = tol > 0 ? 1 - (diff / tol) * 0.5 : 1;
            const timeLimit = Number(state.time_limit_ms);
            if (timeLimit <= 0) {
              earnedPoints = Math.max(250, Math.round(1000 * accuracy));
            } else {
              const timeElapsed = Math.max(
                0,
                now - Number(state.question_start_timestamp)
              );
              const timeFactor = Math.max(
                0.5,
                1 - timeElapsed / (timeLimit * 2)
              );
              earnedPoints = Math.max(
                250,
                Math.round(1000 * accuracy * timeFactor)
              );
            }
          }
        }
      } else if (qType === 'word_cloud') {
        const maxLen = question.maxLength || 32;
        const cleanText = String(text || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxLen);
        if (!cleanText) {
          return socket.emit('error_msg', 'EMPTY_WORD');
        }
        storedValue = cleanText;
      } else {
        return socket.emit('error_msg', 'UNSUPPORTED_QUESTION_TYPE');
      }

      // Atomowe sprawdzenie czy gracz już odpowiedział (HSETNX)
      const isFirstAnswer = await redis.hsetnx(
        `room:${pin}:answers:${qIndex}`,
        socket.id,
        storedValue
      );
      if (!isFirstAnswer) return;

      if (earnedPoints > 0 && socket.data.nickname) {
        await redis.zincrby(
          `room:${pin}:leaderboard`,
          earnedPoints,
          socket.data.nickname
        );
        // Zapisz ile punktów zdobył gracz za to pytanie
        await redis.hset(
          `room:${pin}:earned:${qIndex}`,
          socket.data.nickname,
          earnedPoints
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

async function startServer() {
  try {
    await initDatabase(pool);
  } catch (err) {
    console.error('[POSTGRES_INIT_ERROR] Nie udało się zainicjalizować bazy PostgreSQL:', err.message);
    process.exit(1);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  [CYBER_QUIZ_SERVER] ONLINE              ║`);
    console.log(`  ║  Port: ${PORT}                              ║`);
    console.log(`  ║  Redis: ${REDIS_HOST}:${REDIS_PORT}`);
    console.log(`  ║  Postgres: CONNECTED (migrations OK)`);
    console.log(`  ║  Static UI: ${fs.existsSync(INDEX_HTML) ? 'ENABLED' : 'DEV (no dist)'}`);
    console.log(`  ║  WebSocket: perMessageDeflate OFF        ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

startServer();

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
      try {
        await pool.end();
      } catch (_err) {
        // ignore
      }
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
