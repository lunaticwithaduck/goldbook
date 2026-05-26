/**
 * Downloads wowsims/wotlk's mirror of Wowhead's item tooltip CSV (~50MB, ~50k items)
 * and populates the `item_meta` table.
 *
 *   <id>,{"name":"...","quality":N,"icon":"...","tooltip":"<html>",...}
 *
 * The tooltip HTML embeds `<!--scstart{class}:{subclass}-->` for gear, which we use to
 * recover the class/subclass IDs. For non-gear, we fall back to a name-based heuristic
 * so we can still bucket items into the AH-style category sidebar.
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { openDb } from '../db/client.js';

const TOOLTIPS_URL =
  'https://raw.githubusercontent.com/wowsims/wotlk/master/assets/db_inputs/wowhead_item_tooltips.csv';
const CACHE_PATH = resolve(process.cwd(), 'data', 'wowhead_item_tooltips.csv');

/** Wowhead/Blizzard item-class IDs. */
const CLASS = {
  CONSUMABLE: 0,
  CONTAINER: 1,
  WEAPON: 2,
  GEM: 3,
  ARMOR: 4,
  REAGENT: 5,
  PROJECTILE: 6,
  TRADE_GOODS: 7,
  RECIPE: 9,
  QUIVER: 11,
  QUEST: 12,
  KEY: 13,
  MISC: 15,
  GLYPH: 16,
} as const;

/** Coarse AH categories used for the filter sidebar. */
export const CATEGORIES = [
  'Weapon',
  'Armor',
  'Container',
  'Consumable',
  'Glyph',
  'Trade Goods',
  'Projectile',
  'Quiver',
  'Recipe',
  'Gem',
  'Miscellaneous',
  'Quest',
  'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

const CLASS_TO_CATEGORY: Record<number, Category> = {
  [CLASS.CONSUMABLE]: 'Consumable',
  [CLASS.CONTAINER]: 'Container',
  [CLASS.WEAPON]: 'Weapon',
  [CLASS.GEM]: 'Gem',
  [CLASS.ARMOR]: 'Armor',
  [CLASS.PROJECTILE]: 'Projectile',
  [CLASS.TRADE_GOODS]: 'Trade Goods',
  [CLASS.RECIPE]: 'Recipe',
  [CLASS.QUIVER]: 'Quiver',
  [CLASS.QUEST]: 'Quest',
  [CLASS.MISC]: 'Miscellaneous',
  [CLASS.GLYPH]: 'Glyph',
};

/** Heuristic for items where the tooltip doesn't expose class:subclass markers. */
function guessCategory(name: string, tooltip: string): Category {
  if (/^Glyph of /i.test(name)) return 'Glyph';
  if (/^(?:Pattern|Recipe|Schematic|Formula|Plans|Manual|Design|Book): /i.test(name))
    return 'Recipe';

  // Gems are usually "<Cut> <Stone>" — leave to class detection from tooltip if possible.
  // Common WotLK trade goods (ores/bars/cloth/leather/herbs/elementals/essences/dust)
  if (
    /\b(Ore|Bar|Stone|Powder|Dust|Essence|Eternal|Crystallized|Frozen Orb|Frostweave|Saronite|Cobalt|Titanium|Borean Leather|Heavy Borean Leather|Arctic Fur|Icy Dragonscale|Nerubian Chitin|Jormungar Scale|Boil-Wracked|Snow Lily|Goldclover|Tiger Lily|Talandra's Rose|Adder's Tongue|Lichbloom|Icethorn|Frost Lotus|Pyrium|Crusader Orb|Primal Might|Spider's Silk|Mageweave|Runecloth|Felcloth|Imbued Netherweave|Spellcloth|Soul Dust|Vision Dust|Dream Dust|Illusion Dust|Greater Eternal Essence|Lesser Eternal Essence|Greater Planar Essence|Lesser Planar Essence|Greater Cosmic Essence|Lesser Cosmic Essence|Small Glimmering Shard|Large Glimmering Shard|Large Brilliant Shard|Void Crystal|Abyss Crystal|Infinite Dust|Greater Magic Essence|Lesser Magic Essence|Strange Dust|Small Glowing Shard|Large Glowing Shard|Small Radiant Shard|Large Radiant Shard|Nexus Crystal|Arcane Dust|Lesser Astral Essence|Greater Astral Essence|Lesser Mystic Essence|Greater Mystic Essence|Lesser Nether Essence|Greater Nether Essence|Cloth|Leather|Scale|Hide)\b/i.test(
      name,
    )
  )
    return 'Trade Goods';

  // Potions / Elixirs / Flasks / Food / Bandages → consumables
  if (
    /\b(Potion|Elixir|Flask|Bandage|Conjured|Roasted|Honeymint|Baked|Mead|Beer|Wine|Cake|Cookie|Stew|Soup|Steak|Cheese|Bread)\b/i.test(
      name,
    )
  )
    return 'Consumable';

  if (/\b(Arrow|Bullet|Quiver|Pouch)\b/i.test(name))
    return /Quiver|Pouch/i.test(name) ? 'Quiver' : 'Projectile';

  // Tooltip text hints
  if (/Trade Goods/i.test(tooltip)) return 'Trade Goods';
  if (/Quest Item/i.test(tooltip)) return 'Quest';

  return 'Other';
}

const SCSTART_RE = /<!--scstart(-?\d+):(-?\d+)-->/;

function parseLine(line: string): {
  id: number;
  name: string;
  quality: number;
  icon: string;
  classId: number | null;
  subclassId: number | null;
  category: Category;
} | null {
  const commaIdx = line.indexOf(',');
  if (commaIdx <= 0) return null;
  const id = Number.parseInt(line.slice(0, commaIdx), 10);
  if (!Number.isFinite(id)) return null;
  let json: { name: string; quality: number; icon: string; tooltip: string };
  try {
    json = JSON.parse(line.slice(commaIdx + 1));
  } catch {
    return null;
  }
  if (!json.name || !json.icon) return null;

  const m = SCSTART_RE.exec(json.tooltip ?? '');
  const classId = m ? Number.parseInt(m[1], 10) : null;
  const subclassId = m ? Number.parseInt(m[2], 10) : null;

  let category: Category | undefined =
    classId != null ? CLASS_TO_CATEGORY[classId] : undefined;
  if (!category) category = guessCategory(json.name, json.tooltip ?? '');

  return {
    id,
    name: json.name,
    quality: json.quality,
    icon: json.icon,
    classId,
    subclassId,
    category,
  };
}

async function ensureCsv(force = false): Promise<string> {
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  if (!force && existsSync(CACHE_PATH)) {
    const size = statSync(CACHE_PATH).size;
    if (size > 1_000_000) return CACHE_PATH;
  }
  console.log(`downloading ${TOOLTIPS_URL}`);
  const res = await fetch(TOOLTIPS_URL);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const { writeFile } = await import('node:fs/promises');
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(CACHE_PATH, buf);
  console.log(`wrote ${(buf.length / 1_000_000).toFixed(1)} MB to ${CACHE_PATH}`);
  return CACHE_PATH;
}

async function main() {
  const force = process.argv.includes('--force');
  const path = await ensureCsv(force);

  const { db, sqlite } = openDb();
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  const insert = sqlite.prepare(
    `INSERT INTO item_meta (id, name, quality, icon, class_id, subclass_id, category)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       quality = excluded.quality,
       icon = excluded.icon,
       class_id = excluded.class_id,
       subclass_id = excluded.subclass_id,
       category = excluded.category`,
  );

  const txn = sqlite.transaction((rows: ReturnType<typeof parseLine>[]) => {
    for (const r of rows) {
      if (!r) continue;
      insert.run(r.id, r.name, r.quality, r.icon, r.classId, r.subclassId, r.category);
    }
  });

  let total = 0;
  let buf: ReturnType<typeof parseLine>[] = [];
  for await (const line of rl) {
    buf.push(parseLine(line));
    if (buf.length >= 2000) {
      txn(buf);
      total += buf.length;
      buf = [];
      if (total % 10000 === 0) process.stdout.write(`  ${total} rows…\r`);
    }
  }
  if (buf.length) txn(buf);
  total += buf.length;

  const counts = db.all<{ category: string; n: number }>(
    'SELECT category, COUNT(*) AS n FROM item_meta GROUP BY category ORDER BY n DESC' as never,
  );
  console.log(`\nimported ${total} rows. by category:`);
  for (const c of counts) console.log(`  ${c.n.toString().padStart(6)}  ${c.category}`);

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
