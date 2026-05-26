# goldbook

TradingView-style price tracker for the Warmane (WotLK 3.3.5a) auction house. Ingests scan
data from the in-game **Auctionator** addon, stores it locally in SQLite, and renders
candlestick / line charts in the browser.

## Stack

- **Frontend:** Vite + React 18 + TypeScript, Radix UI primitives, [TradingView
  Lightweight Charts](https://www.tradingview.com/lightweight-charts/), TanStack Query
- **API:** Hono on Node 22 (served by `@hono/node-server`), proxied through Vite at `/api`
- **Storage:** SQLite via `better-sqlite3`, schema managed by Drizzle ORM
- **Tooling:** Biome (lint + format), tsx

## Layout

```
goldbook/
├── server/                  # Node-only code (no React, no JSX)
│   ├── index.ts             # Hono API entry
│   ├── db/{schema,client,migrate}.ts
│   └── parser/
│       ├── lua.ts           # Generic Lua-SavedVariables parser
│       ├── auctionator.ts   # Extracts PRICING_HISTORY scans
│       └── ingest.ts        # CLI: lua -> sqlite
├── src/                     # React app
│   ├── design-system/       # Tokens + primitives (consume tokens, never raw values)
│   │   ├── tokens.ts        # 6 colors / 6 spacings / 6 font sizes
│   │   ├── theme.css        # CSS vars exposed to runtime
│   │   └── components/      # Box, Stack, Text, Button, Card, Input, Separator
│   ├── features/
│   │   ├── item-list/       # Searchable left-rail list
│   │   └── price-chart/     # Lightweight Charts canvas (candles + line + volume)
│   └── lib/                 # api client, currency formatter
├── drizzle/                 # Generated SQL migrations
└── data/                    # Local sqlite db (gitignored)
```

## Setup

```bash
pnpm install
pnpm db:migrate   # creates ./data/goldbook.db with the schema
```

## Ingesting scans

After running an Auctionator scan in-game, log out (so the addon flushes
`SavedVariables`) and run:

```bash
pnpm ingest --realm Icecrown_Horde \
  /home/denshi/Games/WoW/WTF/Account/MIRKO344/SavedVariables/Auctionator.lua
```

- `--realm` is optional, used to tag items if you play on multiple realms.
- Re-ingesting the same file is idempotent: scans are deduped on `(item_id, raw_ts)`.
- Calibration: Auctionator stores timestamps as opaque integers (minutes-since-custom-epoch).
  At ingest we align the file's max `raw_ts` to the file's `mtime` and persist the resulting
  `calibrationOffsetSec` on the `ingests` row. If you discover the true epoch later, you can
  re-derive `observed_at` without re-parsing the lua.

## Running the app

```bash
pnpm dev          # starts Vite on :5173 + API on :3001 (concurrently)
```

Then open http://localhost:5173.

Other scripts:

- `pnpm dev:web` / `pnpm dev:api` — run individually
- `pnpm build` — production bundle to `dist/`
- `pnpm typecheck`
- `pnpm lint` / `pnpm format` (Biome)
- `pnpm db:generate` — regenerate SQL when `schema.ts` changes
- `pnpm db:studio` — Drizzle Studio
- `pnpm meta:fetch` — download and import Wowhead item metadata (icons, quality, AH categories)
- `pnpm backfill` — backfill historical AH data from ah.nerfed.net (see below)

## Backfill historical prices (ah.nerfed.net)

`ah.nerfed.net` is a community-run tracker that has been scanning Warmane AHs daily
since ~early 2023. Their per-item pages embed the full price history as a JS variable;
`pnpm backfill` extracts that and stores it in our `scans` table tagged
`source = 'nerfed:<series>'`.

```bash
pnpm backfill                       # default: realm=Icecrown_Horde, 2.5s/req + jitter
pnpm backfill --delay 5000          # be even more polite
pnpm backfill --limit 100           # smoke test with 100 items
pnpm backfill --retry-errors        # also re-try items previously errored
pnpm backfill --reset               # forget prior progress and start over
```

- **Safe to leave running unattended.** Catches `SIGINT`, persists progress per Wowhead
  item id in `backfill_state`, and resumes from where it stopped on the next run.
- **Five series stored per item:** `nerfed:buyout_min`, `nerfed:buyout_median`,
  `nerfed:bid_mean`, `nerfed:bid_median`, `nerfed:quantity`. The chart only uses
  `buyout_min` by default (`?sources=buyout_min`); pass `?sources=all` to see them all.
- **Throttle.** Default 2.5s + 0–500ms jitter between requests. ah.nerfed.net is one
  person's hobby project — don't tighten this without a reason.
- **Scale.** ~6,300 unique items on Icecrown_Horde, ~5 hours at default throttle. Each
  popular item carries ~1,100 daily timestamps × 5 series ≈ 5,500 rows.

## Design system

Six is the budget for every scale (colors, spacings, font sizes). All primitives consume
tokens via CSS custom properties declared in `src/design-system/theme.css`; raw hex / px
values are forbidden in feature code.

| Token   | Values                                                    |
| ------- | --------------------------------------------------------- |
| color   | `bg`, `surface`, `border`, `text`, `up`, `down`           |
| space   | `1=4`, `2=8`, `3=12`, `4=16`, `5=24`, `6=32` (px)         |
| font    | `1=11`, `2=12`, `3=14`, `4=16`, `5=20`, `6=28` (px)       |

Muted text is `text` at 60% opacity — there is no separate `textMuted` color on purpose.

## Notes & open questions

- Prices are stored in **copper** end-to-end; the UI converts to gold for display.
- The chart uses unix-second timestamps; the candles endpoint buckets server-side.
- Lua parser handles the WoW SavedVariables subset: numbers, strings (with `\xNN` and
  `\ddd` escapes), bools, nil, comments, and mixed-key tables. Untested on long-bracketed
  strings, but WoW never writes those.
- Auctionator's `AUCTIONATOR_PRICING_HISTORY` keeps roughly the most recent scan per
  `raw_ts` value per item; longer history would require periodic ingests (every login).
