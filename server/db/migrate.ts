import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb } from './client.js';

const { db, sqlite } = openDb();
migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
sqlite.close();
console.log('migrations applied');
