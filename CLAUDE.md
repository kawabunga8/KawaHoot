# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server on localhost:3000 (locally run with `-- --port 3008`, per ~/Desktop/rcs-apps-howto.html)
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

## Infrastructure (2026-09-23)

`.env.local` here now points at KawaHoot's **own self-hosted local
Supabase stack** (`http://127.0.0.1:54521`, the `supabase-local/kawahoot`
directory) instead of the original cloud project — old cloud credentials
preserved in a `.env.local.*-backup` file, not deleted. This is **not**
the `supabase-local/shared` stack (`54421`) that Course Hub, Report Card
Tool and Group Maker use, and **not** the similarly-named
`/Volumes/Repos/local-stack` repo (a schema-only stack with no real data).
Start it with `supabase start` in `supabase-local/kawahoot` once Colima is
up; `supabase stop` it before `colima stop`. **Read `local-stack/STATUS.md`
first** for the full current picture. KawaHoot doesn't store rosters
itself either way — it fetches them live from Course Hub per session
(`COURSE_HUB_URL`, locally `http://localhost:3005`).

The Vercel deployment for this project is **paused** (aliases return
`503 DEPLOYMENT_PAUSED`) and **git↔Vercel auto-deploy has been
disconnected** — `git push` no longer creates any new deployment.
Re-enabling either is a deliberate action.

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

- KawaHoot has its **own** Supabase database, separate from Course Hub's — originally the cloud project `KawahootCA` (since 2026-08-06), now the local `supabase-local/kawahoot` stack (see Infrastructure). Students are **not** in this database: rosters come from Course Hub's API (`/api/courses/{id}/roster`) and email sign-in is matched through `/api/students?email=`. `players.student_id` holds the Course Hub student id (no FK, cross-project); `players.identity_verified` is true only when the server verified the sign-in (auto-claim). A database trigger stops anything but the service role from setting either column. See `supabase/migrations/`.
- When a teacher imports a class into a game (`importStudents` in `game/[id]/page.tsx`), players are inserted with `is_pre_registered=true` and `student_id` set, via the `pre_register` action on `/api/game/teams` (`{students: {id, name}[]}`).
- Two ways for a student to claim their pre-registered row:
  1. **Email code sign-in** (`/` → "Sign in with your @rcseagles.ca email" → `supabase.auth.signInWithOtp({ email })` sends a 6-digit code → `supabase.auth.verifyOtp({ email, token: code, type: 'email' })` → `POST /api/game/auto-claim` with the session's access token, sent *before* sign-out; the server verifies it and reads the email from it, never from the request body). Deliberately *not* OAuth (Google/Microsoft) — RCS student email is Microsoft 365, and registering an Azure AD app requires tenant admin rights nobody currently has, so magic-code email auth is the path that needs zero third-party app registration. Matches the email via Course Hub `/api/students?email=` → `players.student_id` in this game, sets `is_claimed=true`, `identity_verified=true`, `nickname`/`real_name` to their real name. The Supabase session is signed out immediately after — this is a one-shot identity check, not a persistent login, since the device may be shared.
  2. **Manual click** — pick your name from the roster grid, then choose a fun display nickname (`/api/game/claim-player`). Both paths race for the same unclaimed row; whichever happens first wins.
  3. If a `@rcseagles.ca` student doesn't match any roster row in this game (not enrolled, no class imported, etc.), `/api/game/auto-claim` falls back to a guest join automatically rather than blocking them.
- Guests (not on roster, or unmatched, or any non-`@rcseagles.ca`/`@myrcs.ca` sign-in) go through `/api/game/join` with just `{ pin }` — no nickname accepted from the client. The server assigns the next free `Guest1`, `Guest2`, ... name in that game (retries on rare collisions via the unique-constraint error code).
- A student being absent never blocks the game: unclaimed pre-registered rows are just inert placeholders, and the host can also explicitly mark someone absent (`remove_player` action) to drop their placeholder entirely.

### Host Authentication

Real Supabase Auth, restricted to `@myrcs.ca` emails, against KawaHoot's **own** `auth.users` table in the `supabase-local/kawahoot` stack. It is **not** shared with Course Hub / RCS Report Card Tool / Group Maker (those use `supabase-local/shared`) or TOC-Dayplans (cloud) — a teacher needs a separate account here, and a password reset means updating `auth.users` in the `supabase_db_kawahoot` container. (Before the local move this said "same account as the other RCS apps"; that no longer holds.)

Student email-code sign-in (see Pre-registration above) sends its 6-digit codes through this stack's local mail catcher, so when running locally they land in the test inbox at `http://localhost:54524`, not in students' real inboxes. The manual roster-click claim path is unaffected.

- `middleware.ts` gates `/host/:path*` and `/game/:path*` (except `/game/[id]/display`, the projector view, intentionally unauthenticated) — redirects to `/login` if there's no session or the email isn't `@myrcs.ca`.
- `/login` (`LoginClient.tsx`) — `supabase.auth.signInWithPassword`, against the KawaHoot stack's own accounts (see above).
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

See `supabase-schema.sql` for the full schema including migrations. Key tables: `games`, `quiz_questions`, `players`, `answers`, `teams`. All have RLS enabled. Reads are open (needed for anonymous PIN lookup, join, and the display view); writes require an authenticated host session except for the narrow anonymous player actions (join, claim-player, identify-player), which are scoped to only touching an unclaimed `players` row — see the "tighten RLS" migration at the end of `supabase-schema.sql` for the full reasoning.

Saved games list (for the host's "My Saved Games" panel) is persisted only in `localStorage` under the key `kawahoot_games`.
