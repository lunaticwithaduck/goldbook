/**
 * Flip finder CLI. Wraps server/analysis/flipFinder.ts for a terminal report.
 *
 *   pnpm flips                        # 20kg bankroll, default filters
 *   pnpm flips --bankroll 50000
 *   pnpm flips --realm Icecrown_Horde --top 200 --positions 8
 *   pnpm flips --min-volume 1000 --min-edge 40 --max-floor 100
 *   pnpm flips --json
 */

import { parseArgs } from 'node:util';
import { openDb } from '../db/client.js';
import {
  AH_CUT,
  type Candidate,
  type FlipOpts,
  type FlipPick,
  findFlips,
  GOLD,
  pickRealm,
} from './flipFinder.js';

type CliArgs = FlipOpts & { json: boolean };

function parseCli(sqlite: ReturnType<typeof openDb>['sqlite']): CliArgs {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      realm: { type: 'string' },
      bankroll: { type: 'string', default: '20000' },
      top: { type: 'string', default: '120' },
      positions: { type: 'string', default: '6' },
      'min-volume': { type: 'string', default: '500' },
      'min-edge': { type: 'string', default: '25' },
      'max-floor': { type: 'string', default: '300' },
      'min-floor': { type: 'string', default: '0.10' },
      'include-projectiles': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: pnpm flips [--realm <name>] [--bankroll <gold>] [--top <n>] [--positions <n>]\n' +
        '                  [--min-volume <units/day>] [--min-edge <pct>]\n' +
        '                  [--max-floor <gold>] [--min-floor <gold>]\n' +
        '                  [--include-projectiles] [--json]',
    );
    process.exit(0);
  }
  return {
    realm: pickRealm(sqlite, values.realm),
    bankrollCopper: Math.round(Number(values.bankroll) * GOLD),
    topCandidates: Number(values.top),
    positions: Number(values.positions),
    minVolume: Number(values['min-volume']),
    minEdgePct: Number(values['min-edge']),
    maxFloorCopper: Math.round(Number(values['max-floor']) * GOLD),
    minFloorCopper: Math.round(Number(values['min-floor']) * GOLD),
    excludeProjectiles: !values['include-projectiles'],
    json: values.json,
  };
}

function fmtGold(copper: number): string {
  const sign = copper < 0 ? '-' : '';
  const c = Math.abs(copper);
  return `${sign}${(c / GOLD).toFixed(2)}g`;
}

function printTable(picks: FlipPick[], traps: Candidate[], opts: FlipOpts) {
  const totalCost = picks.reduce((a, p) => a + p.costCopper, 0);
  const totalProfit = picks.reduce((a, p) => a + p.estProfitCopper, 0);

  console.log(`\nflip picks (realm=${opts.realm}, bankroll=${fmtGold(opts.bankrollCopper)})`);
  console.log('-'.repeat(102));
  console.log(
    'item'.padEnd(28) +
      'buy @'.padStart(11) +
      'sell @'.padStart(11) +
      'edge'.padStart(8) +
      'qty/day'.padStart(10) +
      'units'.padStart(9) +
      'cost'.padStart(13) +
      'profit'.padStart(12),
  );
  console.log('-'.repeat(102));
  for (const p of picks) {
    console.log(
      p.name.slice(0, 27).padEnd(28) +
        fmtGold(p.floorCopper).padStart(11) +
        fmtGold(p.medianCopper).padStart(11) +
        `${p.edgePct.toFixed(0)}%`.padStart(8) +
        p.avgQtyPerDay.toFixed(0).padStart(10) +
        p.suggestedUnits.toString().padStart(9) +
        fmtGold(p.costCopper).padStart(13) +
        fmtGold(p.estProfitCopper).padStart(12),
    );
  }
  console.log('-'.repeat(102));
  console.log(
    `totals: cost ${fmtGold(totalCost)}, projected profit ${fmtGold(totalProfit)} ` +
      `(after ${(AH_CUT * 100).toFixed(0)}% AH cut; assumes full sell-through at median)`,
  );

  if (traps.length > 0) {
    console.log('\ntraps (current floor >= clearing median; do not flip):');
    for (const t of traps.slice(0, 8)) {
      const drift = ((t.floorCopper - t.medianCopper) / t.medianCopper) * 100;
      console.log(
        `  ${t.name.padEnd(27)} floor ${fmtGold(t.floorCopper).padStart(9)} vs med ` +
          `${fmtGold(t.medianCopper).padStart(9)}  (${drift >= 0 ? '+' : ''}${drift.toFixed(0)}%)`,
      );
    }
  }
}

function main() {
  const { db, sqlite } = openDb();
  const args = parseCli(sqlite);

  const result = findFlips(db, sqlite, args);
  if (result.picks.length === 0 && result.traps.length === 0) {
    console.error('no candidates — try lowering --min-volume or check that the db has nerfed data');
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTable(result.picks, result.traps, args);
  }

  sqlite.close();
}

main();
