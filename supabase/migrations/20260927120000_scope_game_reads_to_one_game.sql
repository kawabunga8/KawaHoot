-- Reads of games, players, teams and answers were open to everyone ("Anyone can read
-- ... USING (true)"). The publishable key ships in every page, so while KawaHoot is
-- shared on a classroom Wi-Fi (kawahoot-class), any device could list every game with
-- its PIN, then read the player list of any unfinished game: student names, for an
-- imported class. Players don't need that. They only ever read the one game they joined.
--
-- Players have no session, so the game they are in travels as a request header,
-- x-kawahoot-game, set by createClient(gameId) in src/lib/supabase/{client,server}.ts.
-- Anonymous (and non-host signed-in) reads now return only rows of that game, plus
-- the game it was replayed into, so "Play again" can find the player's new row. The id
-- is a random uuid that a device only learns by joining with the PIN. Searching games by
-- PIN moves to the service role (/api/game/join, /api/game/verify-pin).
--
-- Hosts (signed-in @myrcs.ca) keep full access through the "Hosts manage ..." policies
-- (20260926210000_restrict_game_tables_to_hosts.sql); players' read of every player
-- row, previously open to any signed-in account, is narrowed to hosts as well.
--
-- Realtime has no request headers, so anonymous postgres_changes on these tables stop
-- arriving. The play and display pages already poll every 2-3 seconds and keep working.

create or replace function public.request_game_id() returns uuid
language sql stable set search_path = '' as $$
  select case when h ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then h::uuid end
  from (select nullif(current_setting('request.headers', true), '')::json ->> 'x-kawahoot-game' as h) s
$$;

-- The requested game and the game it was replayed into. Security definer so that the
-- players/teams policies can look at games without going through games' own policy.
create or replace function public.request_game_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select g.id from public.games g where g.id = public.request_game_id()
  union
  select g.next_game_id from public.games g
   where g.id = public.request_game_id() and g.next_game_id is not null
$$;

revoke execute on function public.request_game_ids() from public;
grant execute on function public.request_game_id(), public.request_game_ids() to anon, authenticated;

drop policy if exists "Anyone can read games" on public.games;
create policy "Players read their own game" on public.games
  for select to anon, authenticated
  using (id in (select public.request_game_ids()));

drop policy if exists "Anyone can read players in active games" on public.players;
drop policy if exists "Authenticated can read all players" on public.players;
create policy "Players read players in their own game" on public.players
  for select to anon, authenticated
  using (
    game_id in (select public.request_game_ids())
    and exists (select 1 from public.games g where g.id = players.game_id and g.status <> 'finished')
  );
create policy "Hosts read all players" on public.players
  for select to authenticated
  using (lower(auth.jwt() ->> 'email') like '%@myrcs.ca');

drop policy if exists "Anyone can read teams" on public.teams;
create policy "Players read teams in their own game" on public.teams
  for select to anon, authenticated
  using (game_id in (select public.request_game_ids()));

drop policy if exists "Anyone can read answers" on public.answers;
create policy "Players read answers in their own game" on public.answers
  for select to anon, authenticated
  using (game_id in (select public.request_game_ids()));
