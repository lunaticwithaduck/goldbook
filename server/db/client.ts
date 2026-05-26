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
  // Auto-checkpoint when the WAL exceeds ~16 MB (4000 × 4 KB pages). Default 1000 is
  // too small to amortize fsyncs during the nerfed backfill, which used to balloon
  // the WAL to >1 GB and tank read latency. NORMAL synchronous gives us crash safety
  // for the OS layer without the per-commit fsync of FULL.
  sqlite.pragma('wal_autocheckpoint = 4000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
