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
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
SUPABASE_SECRET_KEY          # service role key — bypasses RLS, server-only
```

No host password env var anymore — see Host Authentication below.

## Architecture

Kawahoot is a Kahoot-style classroom quiz game. Next.js 14 App Router + Supabase (database + realtime). All pages are `'use client'` — there are no server components.

### Routes

| Route | Purpose |
|---|---|
| `/` | Player join: PIN → roster selection (or auto-named guest) |
| `/host` | Teacher: create games, manage class rosters (requires `@myrcs.ca` login) |
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

- `classes` and `students` tables are shared with student-hub (the central student data app) and a separate "Group Maker" app, same Supabase project. `students.email` and `players.student_id` are what link a signed-in student to their roster row.
- When a teacher imports a class into a game (`importStudents` in `game/[id]/page.tsx`), players are inserted with `is_pre_registered=true` and `student_id` set, via the `pre_register` action on `/api/game/teams` (`{students: {id, name}[]}`).
- Two ways for a student to claim their pre-registered row:
  1. **Google sign-in** (`/` → "Sign in with Google (@rcseagles.ca)" → OAuth redirect back to `/?pin=...&gameId=...` → `POST /api/game/auto-claim` with the signed-in email). Matches `students.email` → `players.student_id` in this game, sets `is_claimed=true`, `nickname`/`real_name` to their real name. The Supabase session is signed out immediately after — this is a one-shot identity check, not a persistent login, since the device may be shared.
  2. **Manual click** — pick your name from the roster grid, then choose a fun display nickname (`/api/game/claim-player`). Both paths race for the same unclaimed row; whichever happens first wins.
  3. If a `@rcseagles.ca` student doesn't match any roster row in this game (not enrolled, no class imported, etc.), `/api/game/auto-claim` falls back to a guest join automatically rather than blocking them.
- Guests (not on roster, or unmatched, or any non-`@rcseagles.ca`/`@myrcs.ca` sign-in) go through `/api/game/join` with just `{ pin }` — no nickname accepted from the client. The server assigns the next free `Guest1`, `Guest2`, ... name in that game (retries on rare collisions via the unique-constraint error code).
- A student being absent never blocks the game: unclaimed pre-registered rows are just inert placeholders, and the host can also explicitly mark someone absent (`remove_player` action) to drop their placeholder entirely.

### Host Authentication

Real Supabase Auth, same account as TOC-Dayplans / Student Hub / RCS Report Card Tool (same Supabase project, same `auth.users` table) — restricted to `@myrcs.ca` emails.

- `middleware.ts` gates `/host/:path*` and `/game/:path*` (except `/game/[id]/display`, the projector view, intentionally unauthenticated) — redirects to `/login` if there's no session or the email isn't `@myrcs.ca`.
- `/login` (`LoginClient.tsx`) — `supabase.auth.signInWithPassword`. No separate teacher account needed if you already have one for the other RCS apps.
- API routes call `await requireHost(req)` (`src/lib/require-host.ts`), which checks the real session server-side via `createClient()` from `src/lib/supabase/server.ts` — not a password comparison.
- `hostFetch()` (`src/lib/host-fetch.ts`) is now a thin `fetch` wrapper with `credentials: 'include'` — the session travels as a cookie automatically on same-origin requests, no token/header needed.
- `HostGate` is a no-op passthrough component kept only so `/host` and `/game/[id]` don't need their JSX restructured — the real gate is `middleware.ts`, which runs before the page renders.

### Scoring

500 base points + up to 500 speed bonus, scaling linearly with how quickly the answer was submitted within the time limit. See `calculatePoints` in `src/lib/game-utils.ts`.

### Styling

Tailwind with a custom palette. Use these tokens instead of raw hex values:

`kawaDark` `kawaPurple` `kawaYellow` `kawaCoral` `kawared` `kawaBlue` `kawaGreen` `kawaLight`

Answer options always map: A=red/▲, B=blue/◆, C=yellow/●, D=green/■ — see `ANSWER_COLORS`/`ANSWER_SHAPES` in `src/lib/game-utils.ts`.

### Database Schema

See `supabase-schema.sql` for the full schema including migrations. Key tables: `games`, `quiz_questions`, `players`, `answers`, `teams`. All have RLS enabled with permissive "allow all" policies — intentional for a no-auth classroom app.

Saved games list (for the host's "My Saved Games" panel) is persisted only in `localStorage` under the key `kawahoot_games`.
