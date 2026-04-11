# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server on localhost:3000
npm run build     # production build
npm run lint      # ESLint via next lint
```

There is no test runner configured.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SECRET_KEY          # service role key — bypasses RLS, server-only
NEXT_PUBLIC_HOST_PASSWORD    # teacher password, defaults to 'teacher'
```

## Architecture

Kawahoot is a Kahoot-style classroom quiz game. Next.js 14 App Router + Supabase (database + realtime). All pages are `'use client'` — there are no server components.

### Routes

| Route | Purpose |
|---|---|
| `/` | Player join: PIN → roster selection → nickname |
| `/host` | Teacher: create games, manage class rosters |
| `/game/[id]` | Host control panel during a live game |
| `/game/[id]/display` | Projector view (no auth) |
| `/play/[gameId]` | Player in-game view |
| `/api/game/*` | Game state machine — all mutations go through here |
| `/api/classes` | Class/roster CRUD |

### Supabase Clients

Three clients in `src/lib/supabase/`:

- `client.ts` — browser client using anon key; used in all page components
- `server.ts` — server client using anon key; used in API routes for standard queries
- `admin.ts` — service role client bypassing RLS; use in API routes when anon key is insufficient (e.g. `verify-pin`, writes needing elevated access)

In React components, always instantiate with `useMemo(() => createClient(), [])` to avoid recreating the client on every render.

### Game State Machine

Game `status` transitions: `waiting → question → answer_reveal → leaderboard → finished` (also `paused`).

State transitions are always driven by API routes (`/api/game/*`), never by direct client writes to the `games` table. Realtime updates flow back to clients via Supabase subscriptions on the `games`, `players`, `answers`, and `teams` tables.

### Pre-registration / Roster System

- `classes` and `students` tables are shared with a separate "Group Maker" app in the same Supabase project.
- When a teacher imports a class into a game, players are inserted with `is_pre_registered=true`.
- When a student joins, they claim their pre-registered row: `is_claimed=true` is set and `nickname` is updated. `real_name` stores the original roster name.
- Guest joins (not on roster) go through `/api/game/join` and create a fresh player row.

### Host Authentication

`HostGate` component and `useHostAuth` hook (`src/lib/host-auth.ts`) gate the `/host` and `/game/[id]` pages. Auth state is stored in `sessionStorage` only — it is intentionally not secure, just a soft barrier for classroom use. Password comes from `NEXT_PUBLIC_HOST_PASSWORD`.

### Scoring

500 base points + up to 500 speed bonus, scaling linearly with how quickly the answer was submitted within the time limit. See `calculatePoints` in `src/lib/game-utils.ts`.

### Styling

Tailwind with a custom palette. Use these tokens instead of raw hex values:

`kawaDark` `kawaPurple` `kawaYellow` `kawaCoral` `kawared` `kawaBlue` `kawaGreen` `kawaLight`

Answer options always map: A=red/▲, B=blue/◆, C=yellow/●, D=green/■ — see `ANSWER_COLORS`/`ANSWER_SHAPES` in `src/lib/game-utils.ts`.

### Database Schema

See `supabase-schema.sql` for the full schema including migrations. Key tables: `games`, `quiz_questions`, `players`, `answers`, `teams`. All have RLS enabled with permissive "allow all" policies — intentional for a no-auth classroom app.

Saved games list (for the host's "My Saved Games" panel) is persisted only in `localStorage` under the key `kawahoot_games`.
