import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import logger from '../logger.js';

type Migration = {
  version: number;
  name: string;
  up: (db: BetterSqlite3Database) => void;
};

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS budgets (
          id TEXT PRIMARY KEY,
          scope_type TEXT NOT NULL CHECK (scope_type IN ('account','role','user')),
          scope_id TEXT NOT NULL,
          period TEXT NOT NULL CHECK (period IN ('monthly','daily','rolling_30d')),
          currency TEXT NOT NULL DEFAULT 'USD',
          limit_cents INTEGER NOT NULL,
          hard_limit INTEGER NOT NULL DEFAULT 0,
          reset_day INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(scope_type, scope_id)
        );

        CREATE TABLE IF NOT EXISTS usage_records (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          user_id TEXT,
          role TEXT,
          model TEXT,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          cached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          cost_cents INTEGER NOT NULL DEFAULT 0,
          occurred_at TEXT NOT NULL,
          session_id TEXT,
          tool_name TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_usage_account_timestamp ON usage_records(account_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id);
      `);

      const oneRow = db.prepare('SELECT id FROM accounts LIMIT 1').get();
      if (!oneRow) {
        db.prepare(
          `INSERT INTO accounts (id, name, metadata) VALUES (@id, @name, @metadata)`,
        ).run({ id: randomUUID(), name: 'Default', metadata: JSON.stringify({ seeded: true }) });
      }
    },
  },
];

export function runMigrations(db: BetterSqlite3Database): void {
  const currentVersion = Number(db.pragma('user_version', { simple: true }));
  const pending = migrations.filter((migration) => migration.version > currentVersion).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    logger.info({ version: migration.version, name: migration.name }, 'Applying database migration');
    const transaction = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    transaction();
  }
}
