import { statSync } from 'node:fs';
import { openDb } from './client.js';

const { sqlite } = openDb();

const before = (() => {
  try {
    return statSync('data/goldbook.db-wal').size;
  } catch {
    return 0;
  }
})();

console.log(`WAL before: ${(before / 1_000_000).toFixed(1)} MB`);
console.log('running wal_checkpoint(TRUNCATE)…');
const t = Date.now();
const res = sqlite.pragma('wal_checkpoint(TRUNCATE)');
console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)}s; result:`, res);

const after = (() => {
  try {
    return statSync('data/goldbook.db-wal').size;
  } catch {
    return 0;
  }
})();
console.log(`WAL after: ${(after / 1_000_000).toFixed(1)} MB`);
sqlite.close();
