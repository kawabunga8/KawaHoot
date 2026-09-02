-- Kawahoot Database Schema
-- Run this in your Supabase SQL editor

-- Games table
create table if not exists games (
  id uuid default gen_random_uuid() primary key,
  pin text not null unique,
  host_id text,
  title text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'question', 'answer_reveal', 'leaderboard', 'finished', 'paused')),
  current_question_index integer not null default -1,
  current_question_started_at timestamptz,
  next_game_id uuid,  -- set when host replays; players follow to this game
  created_at timestamptz default now()
);
-- Quiz questions table
create table if not exists quiz_questions (
  id uuid default gen_random_uuid() primary key,
  game_id uuid not null references games(id) on delete cascade,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer char(1) not null check (correct_answer in ('A','B','C','D')),
  time_limit integer not null default 20,
  order_index integer not null,
  created_at timestamptz default now()
);

-- Players table
create table if not exists players (
  id uuid default gen_random_uuid() primary key,
  game_id uuid not null references games(id) on delete cascade,
  nickname text not null,
  score integer not null default 0,
  joined_at timestamptz default now()
);

-- Answers table
create table if not exists answers (
  id uuid default gen_random_uuid() primary key,
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  question_id uuid not null references quiz_questions(id) on delete cascade,
  selected_answer char(1) not null check (selected_answer in ('A','B','C','D')),
  is_correct boolean not null default false,
  response_time_ms integer not null default 0,
  points_earned integer not null default 0,
  answered_at timestamptz default now(),
  unique(player_id, question_id)
);

-- Indexes for performance
create index if not exists idx_games_pin on games(pin);
create index if not exists idx_games_status on games(status);
create index if not exists idx_quiz_questions_game_id on quiz_questions(game_id);
create index if not exists idx_players_game_id on players(game_id);
create index if not exists idx_answers_question_id on answers(question_id);
create index if not exists idx_answers_player_id on answers(player_id);

-- Enable Row Level Security (open access for this demo)
alter table games enable row level security;
alter table quiz_questions enable row level security;
alter table players enable row level security;
alter table answers enable row level security;

-- RLS Policies (allow all for anon - suitable for classroom use)
create policy "Allow all on games" on games for all using (true) with check (true);
create policy "Allow all on players" on players for all using (true) with check (true);
create policy "Allow all on answers" on answers for all using (true) with check (true);

-- quiz_questions is deliberately NOT readable by anon: the row contains
-- correct_answer, so an "allow all" policy hands every player the answer key via
-- the public REST API, no matter what the app fetches. Players get questions
-- through /api/game/current-question, which uses the service-role key and
-- withholds correct_answer until the host reveals it. Hosts are authenticated.
create policy "Hosts read quiz_questions" on quiz_questions
  for select to authenticated using (true);
create policy "Hosts write quiz_questions" on quiz_questions
  for all to authenticated using (true) with check (true);

-- Enable realtime on all tables
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table answers;

-- Required for filtered realtime subscriptions (filter by non-PK columns like game_id)
alter table games replica identity full;
alter table players replica identity full;
alter table answers replica identity full;
alter table quiz_questions replica identity full;

-- Atomic score increment used by /api/game/answer. Read-modify-write from the
-- app would lose points when two answers land at once, which is the normal case
-- in a live game. This was previously missing from this file even though the
-- route depends on it: without it every score silently stays 0.
create or replace function increment_player_score(player_id_param uuid, points_param integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update players set score = score + points_param where id = player_id_param;
end;
$$;

-- Classes + Students tables (shared with Group Maker app)
-- These already exist in the shared Supabase project; documented here for reference.
-- classes: id, name, created_at
-- students: id, class_id (FK classes), full_name, created_at

-- Migration: add next_game_id to existing databases
alter table games add column if not exists next_game_id uuid;

-- Migration: teams feature
alter table games add column if not exists mode text not null default 'individual' check (mode in ('individual', 'teams'));

create table if not exists teams (
  id uuid default gen_random_uuid() primary key,
  game_id uuid not null references games(id) on delete cascade,
  name text not null,
  color text not null default 'purple',
  created_at timestamptz default now()
);

alter table players add column if not exists team_id uuid references teams(id) on delete set null;
alter table games add column if not exists previous_status text;
alter table players add column if not exists is_pre_registered boolean not null default false;
alter table players add column if not exists real_name text;
alter table players add column if not exists is_claimed boolean not null default false;
alter table players add column if not exists student_id uuid references public.students(id);
create index if not exists idx_players_student_id on players(student_id);

create index if not exists idx_teams_game_id on teams(game_id);
create index if not exists idx_players_team_id on players(team_id);

create policy "Allow all on teams" on teams for all using (true) with check (true);
alter table teams enable row level security;
alter publication supabase_realtime add table teams;
alter table teams replica identity full;

-- Migration: tighten RLS on games/players/answers/teams.
--
-- The original "allow all" policies meant anyone holding the public anon key
-- (visible to anyone who opens dev tools — that's normal for Supabase, RLS is
-- supposed to be the real gate) could read or write every row in these tables
-- directly via the Supabase API, bypassing the app entirely: every game ever
-- played, every real student name tied to a score, readable and *writable* by
-- anyone on the internet, forever, not just people in the room with the PIN.
--
-- Verified against every current API route before writing this: all game/team
-- state-changing actions (create, start, pause, reveal, next-question,
-- show-scores, restart, end, replay, team management) go through requireHost()
-- and run with a real authenticated session. The only writes a genuinely
-- anonymous player needs are join (insert an unclaimed player row),
-- claim-player and identify-player (update/delete an *unclaimed* player row).
-- Policies below allow exactly that and nothing more; every other write now
-- requires a real @myrcs.ca host session.
drop policy if exists "Allow all on games" on games;
drop policy if exists "Allow all on players" on players;
drop policy if exists "Allow all on answers" on answers;
drop policy if exists "Allow all on teams" on teams;

-- games: anyone can still read (needed for PIN lookup, join, display);
-- only an authenticated host can create or change one.
create policy "Anyone can read games" on games for select using (true);
create policy "Authenticated can insert games" on games for insert to authenticated with check (true);
create policy "Authenticated can update games" on games for update to authenticated using (true) with check (true);
create policy "Authenticated can delete games" on games for delete to authenticated using (true);

-- teams: same pattern. All team management runs through requireHost().
create policy "Anyone can read teams" on teams for select using (true);
create policy "Authenticated can insert teams" on teams for insert to authenticated with check (true);
create policy "Authenticated can update teams" on teams for update to authenticated using (true) with check (true);
create policy "Authenticated can delete teams" on teams for delete to authenticated using (true);

-- answers: the app always writes these via the service-role client (bypasses
-- RLS), so requiring authenticated here is defense-in-depth, not something any
-- current flow depends on. Reads stay open (players/display need live counts).
create policy "Anyone can read answers" on answers for select using (true);
create policy "Authenticated can insert answers" on answers for insert to authenticated with check (true);
create policy "Authenticated can update answers" on answers for update to authenticated using (true) with check (true);
create policy "Authenticated can delete answers" on answers for delete to authenticated using (true);

-- players: real names stay visible during a live game by design (that's the
-- feature, same as a real Kahoot screen) — but not forever, and not writable
-- by anyone who isn't touching their own unclaimed row.
create policy "Anyone can read players in active games" on players
  for select using (
    exists (select 1 from games g where g.id = players.game_id and g.status <> 'finished')
  );
create policy "Authenticated can read all players" on players
  for select to authenticated using (true);

create policy "Authenticated can insert players" on players
  for insert to authenticated with check (true);
create policy "Anonymous join creates only a fresh unclaimed row" on players
  for insert to anon with check (score = 0 and is_claimed = false and is_pre_registered = false);

create policy "Authenticated can update players" on players
  for update to authenticated using (true) with check (true);
create policy "Anonymous can only update an unclaimed player" on players
  for update to anon using (is_claimed = false);

create policy "Authenticated can delete players" on players
  for delete to authenticated using (true);
create policy "Anonymous can only delete an unclaimed roster placeholder" on players
  for delete to anon using (is_pre_registered = true and is_claimed = false);
