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
  {
    version: 2,
    name: 'tool-invocations',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_invocations (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          tool_name TEXT NOT NULL,
          args_json TEXT,
          result_json TEXT,
          error TEXT,
          occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_tool_invocations_session ON tool_invocations(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_invocations_time ON tool_invocations(occurred_at);
      `);
    },
  },
  {
    version: 3,
    name: 'llm-traces',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS llm_traces (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          route TEXT,
          phase TEXT,
          model TEXT,
          iteration INTEGER,
          status TEXT,
          meta_json TEXT,
          payload_json TEXT,
          occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_llm_traces_session ON llm_traces(session_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_llm_traces_route ON llm_traces(route, occurred_at);
      `);
    },
  },
  {
    version: 4,
    name: 'tool-access',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tool_definitions (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (group_id) REFERENCES tool_groups(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tool_definitions_group ON tool_definitions(group_id, is_active);

        CREATE TABLE IF NOT EXISTS role_tool_group_permissions (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          group_id TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'global',
          allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
          source TEXT NOT NULL DEFAULT 'manual',
          updated_by TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (group_id) REFERENCES tool_groups(id) ON DELETE CASCADE,
          UNIQUE(role, group_id, scope)
        );

        CREATE INDEX IF NOT EXISTS idx_role_tool_group_permissions_role ON role_tool_group_permissions(role, scope);

        CREATE TABLE IF NOT EXISTS role_tool_permissions (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          tool_id TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'global',
          allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
          reason TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          updated_by TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (tool_id) REFERENCES tool_definitions(id) ON DELETE CASCADE,
          UNIQUE(role, tool_id, scope)
        );

        CREATE INDEX IF NOT EXISTS idx_role_tool_permissions_role ON role_tool_permissions(role, scope);

        CREATE TABLE IF NOT EXISTS tool_access_audit (
          id TEXT PRIMARY KEY,
          actor TEXT NOT NULL,
          role TEXT NOT NULL,
          scope TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK (target_type IN ('group','tool')),
          target_id TEXT NOT NULL,
          previous_state TEXT,
          next_state TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_tool_access_audit_target ON tool_access_audit(target_id, target_type);
        CREATE INDEX IF NOT EXISTS idx_tool_access_audit_created ON tool_access_audit(created_at);
      `);
    },
  },
  {
    version: 5,
    name: 'idempotency-keys',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT NOT NULL,
          account_id TEXT NOT NULL DEFAULT '',
          scope TEXT NOT NULL,
          body_hash TEXT NOT NULL,
          status INTEGER NOT NULL,
          response_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT,
          PRIMARY KEY (key, account_id, scope)
        );

        CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency_keys(created_at);
      `);
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
