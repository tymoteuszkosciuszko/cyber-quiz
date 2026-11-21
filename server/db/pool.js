import pg from 'pg';
import { SEED_TEMPLATES } from './seedTemplates.js';

const { Pool } = pg;

export function createPool() {
  const isProd = process.env.NODE_ENV === 'production';

  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  const password =
    process.env.PGPASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    (isProd ? '' : 'cyber_quiz_dev');

  if (isProd && !password) {
    throw new Error(
      'Brak konfiguracji bazy danych (DATABASE_URL lub PGPASSWORD) w trybie produkcyjnym.'
    );
  }

  return new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'cyber_quiz',
    user: process.env.PGUSER || process.env.POSTGRES_USER || 'cyber_quiz',
    password,
    max: Number(process.env.PGPOOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

const MIGRATION_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username              TEXT NOT NULL,
  username_normalized   TEXT NOT NULL UNIQUE,
  role                  TEXT NOT NULL CHECK (role IN ('admin', 'superadmin')),
  password_hash         TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at         TIMESTAMPTZ
);

-- Twarda gwarancja istnienia maksymalnie jednego konta superadmin
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_superadmin
  ON users (role)
  WHERE role = 'superadmin';

CREATE TABLE IF NOT EXISTS quizzes (
  id            TEXT PRIMARY KEY,
  owner_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  is_template   BOOLEAN NOT NULL DEFAULT FALSE,
  title         TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('quiz', 'opinion', 'mixed')),
  questions     JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (is_template = TRUE AND owner_id IS NULL)
    OR (is_template = FALSE AND owner_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_quizzes_owner ON quizzes (owner_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id      UUID,
  actor_name    TEXT,
  event_type    TEXT NOT NULL,
  target_id     TEXT,
  ip_address    INET,
  user_agent    TEXT,
  status        TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE')),
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_logs (event_type);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  TEXT NOT NULL UNIQUE,
  public_key     BYTEA NOT NULL,
  counter        BIGINT NOT NULL DEFAULT 0,
  transports     TEXT[] NOT NULL DEFAULT '{}',
  device_type    TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up      BOOLEAN NOT NULL DEFAULT FALSE,
  aaguid         TEXT,
  name           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user_id ON webauthn_credentials (user_id);
`;

export async function initDatabase(pool) {
  await pool.query(MIGRATION_SQL);

  // Seed wbudowanych szablonów (idempotentny)
  for (const tpl of SEED_TEMPLATES) {
    await pool.query(
      `INSERT INTO quizzes (id, owner_id, is_template, title, mode, questions)
       VALUES ($1, NULL, TRUE, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [tpl.id, tpl.title, tpl.mode, JSON.stringify(tpl.questions)]
    );
  }
}

