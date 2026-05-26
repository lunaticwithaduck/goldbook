import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DEFAULT_DB_PATH = resolve(process.cwd(), 'data', 'goldbook.db');

export type DB = BetterSQLite3Database<typeof schema>;

export function openDb(dbPath: string = DEFAULT_DB_PATH): {
  db: DB;
  sqlite: SqliteDatabase;
} {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
