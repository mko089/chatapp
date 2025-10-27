import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import logger from '../logger.js';
import { runMigrations } from './migrations.js';

let dbInstance: BetterSqlite3Database | null = null;

export async function initDatabase(databasePath: string): Promise<BetterSqlite3Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  logger.info({ databasePath: resolvedPath }, 'Initialising SQLite database');

  const db = new Database(resolvedPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  dbInstance = db;
  return dbInstance;
}

export function getDb(): BetterSqlite3Database {
  if (!dbInstance) {
    throw new Error('Database has not been initialised. Call initDatabase() first.');
  }
  return dbInstance;
}
