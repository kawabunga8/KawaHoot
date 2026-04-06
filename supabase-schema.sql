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
create policy "Allow all on quiz_questions" on quiz_questions for all using (true) with check (true);
create policy "Allow all on players" on players for all using (true) with check (true);
create policy "Allow all on answers" on answers for all using (true) with check (true);

-- Enable realtime on all tables
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table answers;

-- Required for filtered realtime subscriptions (filter by non-PK columns like game_id)
alter table games replica identity full;
alter table players replica identity full;
alter table answers replica identity full;
alter table quiz_questions replica identity full;

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
alter table players add column if not exists is_pre_registered boolean not null default false;
alter table players add column if not exists real_name text;
alter table players add column if not exists is_claimed boolean not null default false;

create index if not exists idx_teams_game_id on teams(game_id);
create index if not exists idx_players_team_id on players(team_id);

create policy "Allow all on teams" on teams for all using (true) with check (true);
alter table teams enable row level security;
alter publication supabase_realtime add table teams;
alter table teams replica identity full;
