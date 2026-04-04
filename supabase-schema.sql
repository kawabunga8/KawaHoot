-- Kawahoot Database Schema
-- Run this in your Supabase SQL editor

-- Games table
create table if not exists games (
  id uuid default gen_random_uuid() primary key,
  pin text not null unique,
  host_id text,
  title text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'question', 'answer_reveal', 'leaderboard', 'finished')),
  current_question_index integer not null default -1,
  current_question_started_at timestamptz,
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
