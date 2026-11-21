import { v4 as uuidv4 } from 'uuid';

function hasAnyImages(questions) {
  if (!Array.isArray(questions)) return false;
  return questions.some(
    (item) =>
      Boolean(item?.image) ||
      (Array.isArray(item?.answerImages) && item.answerImages.some(Boolean))
  );
}

function mapQuizSummary(row, user) {
  const questions = Array.isArray(row.questions) ? row.questions : [];
  const isTemplate = Boolean(row.is_template);
  const isOwner = Boolean(row.owner_id && row.owner_id === user.id);
  const isSuperAdmin = user.role === 'superadmin';

  return {
    id: row.id,
    title: row.title,
    mode: row.mode || 'quiz',
    questionsCount: questions.length,
    hasImages: hasAnyImages(questions),
    isTemplate,
    isOwner,
    canEdit: isOwner || (isTemplate && isSuperAdmin),
    canDelete: isOwner || (!isTemplate && isSuperAdmin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapQuizFull(row, user) {
  const summary = mapQuizSummary(row, user);
  return {
    ...summary,
    questions: Array.isArray(row.questions) ? row.questions : [],
  };
}

export async function listQuizzesForUser(pool, user) {
  const { rows } = await pool.query(
    `SELECT id, owner_id, is_template, title, mode, questions, created_at, updated_at
     FROM quizzes
     WHERE owner_id = $1 OR is_template = TRUE
     ORDER BY is_template ASC, updated_at DESC`,
    [user.id]
  );
  return rows.map((row) => mapQuizSummary(row, user));
}

export async function getQuizByIdForUser(pool, quizId, user) {
  const { rows } = await pool.query(
    `SELECT id, owner_id, is_template, title, mode, questions, created_at, updated_at
     FROM quizzes
     WHERE id = $1`,
    [quizId]
  );
  const row = rows[0];
  if (!row) return null;

  const isOwner = row.owner_id === user.id;
  const canRead = isOwner || row.is_template || user.role === 'superadmin';
  if (!canRead) return null;

  return mapQuizFull(row, user);
}

export async function getQuizByIdInternal(pool, quizId) {
  const { rows } = await pool.query(
    `SELECT id, owner_id, is_template, title, mode, questions
     FROM quizzes
     WHERE id = $1`,
    [quizId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    isTemplate: Boolean(row.is_template),
    title: row.title,
    mode: row.mode || 'quiz',
    questions: Array.isArray(row.questions) ? row.questions : [],
  };
}

export async function createQuiz(pool, user, { title, mode, questions }) {
  const id = uuidv4();
  const { rows } = await pool.query(
    `INSERT INTO quizzes (id, owner_id, is_template, title, mode, questions)
     VALUES ($1, $2, FALSE, $3, $4, $5::jsonb)
     RETURNING id, owner_id, is_template, title, mode, questions, created_at, updated_at`,
    [id, user.id, title, mode, JSON.stringify(questions)]
  );
  return mapQuizFull(rows[0], user);
}

export async function cloneQuiz(pool, sourceQuizId, user) {
  const source = await getQuizByIdForUser(pool, sourceQuizId, user);
  if (!source) return null;

  const suffix = ' (Kopia)';
  const baseTitle = source.title.slice(0, 160 - suffix.length);
  return createQuiz(pool, user, {
    title: `${baseTitle}${suffix}`,
    mode: source.mode,
    questions: source.questions,
  });
}

export async function updateQuiz(pool, quizId, user, { title, mode, questions }) {
  const { rows: existingRows } = await pool.query(
    `SELECT id, owner_id, is_template FROM quizzes WHERE id = $1`,
    [quizId]
  );
  const existing = existingRows[0];
  if (!existing) {
    return { error: 'QUIZ_NOT_FOUND', status: 404 };
  }

  if (existing.is_template) {
    if (user.role !== 'superadmin') {
      return { error: 'TEMPLATE_READ_ONLY', status: 403 };
    }
  } else if (existing.owner_id !== user.id) {
    // Nie ujawniamy istnienia cudzego prywatnego quizu (ASVS V4.1.3)
    return { error: 'QUIZ_NOT_FOUND', status: 404 };
  }

  const { rows } = await pool.query(
    `UPDATE quizzes
     SET title = $2, mode = $3, questions = $4::jsonb, updated_at = NOW()
     WHERE id = $1
     RETURNING id, owner_id, is_template, title, mode, questions, created_at, updated_at`,
    [quizId, title, mode, JSON.stringify(questions)]
  );

  return { quiz: mapQuizFull(rows[0], user) };
}

export async function deleteQuiz(pool, quizId, user) {
  const { rows: existingRows } = await pool.query(
    `SELECT id, owner_id, is_template, title FROM quizzes WHERE id = $1`,
    [quizId]
  );
  const existing = existingRows[0];
  if (!existing) {
    return { error: 'QUIZ_NOT_FOUND', status: 404 };
  }

  if (existing.is_template) {
    return { error: 'TEMPLATE_CANNOT_BE_DELETED', status: 403 };
  }

  if (existing.owner_id !== user.id && user.role !== 'superadmin') {
    return { error: 'QUIZ_NOT_FOUND', status: 404 };
  }

  await pool.query(`DELETE FROM quizzes WHERE id = $1`, [quizId]);
  return { deleted: true, title: existing.title };
}

