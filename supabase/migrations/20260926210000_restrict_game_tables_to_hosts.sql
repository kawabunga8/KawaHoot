-- games, teams and answers allowed insert/update/delete for ANY signed-in user
-- ("Authenticated can ... USING (true)"), on the assumption that only hosts ever sign
-- in. That is not true: students can hold a session too (the email-code sign-in creates
-- one), and so can anyone who can sign up. A signed-in student could create, rename,
-- end or delete games, and edit or delete teams and answers, straight through the REST
-- API with their own session token.
--
-- Nothing legitimate needs that. Every route that writes these tables with a session
-- client is already gated by requireHost (create, start, next-question, reveal,
-- show-scores, pause, end, restart, replay, teams), and players' answers go through
-- /api/game/answer, which uses the service role and bypasses RLS. Reads stay public
-- (anonymous PIN lookup, joining, the projector view).
--
-- Writes now require a signed-in @myrcs.ca host, matching kawahoot_classes/students
-- (20260926200000_restrict_class_lists_to_hosts.sql). Like that migration, this is only
-- as strong as who can obtain an @myrcs.ca session, so keep sign-up confirmed or closed
-- ([auth.email] enable_confirmations = true).
drop policy if exists "Authenticated can insert games" on public.games;
drop policy if exists "Authenticated can update games" on public.games;
drop policy if exists "Authenticated can delete games" on public.games;
drop policy if exists "Authenticated can insert teams" on public.teams;
drop policy if exists "Authenticated can update teams" on public.teams;
drop policy if exists "Authenticated can delete teams" on public.teams;
drop policy if exists "Authenticated can insert answers" on public.answers;
drop policy if exists "Authenticated can update answers" on public.answers;
drop policy if exists "Authenticated can delete answers" on public.answers;

create policy "Hosts manage games" on public.games
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') like '%@myrcs.ca')
  with check (lower(auth.jwt() ->> 'email') like '%@myrcs.ca');

create policy "Hosts manage teams" on public.teams
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') like '%@myrcs.ca')
  with check (lower(auth.jwt() ->> 'email') like '%@myrcs.ca');

create policy "Hosts manage answers" on public.answers
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') like '%@myrcs.ca')
  with check (lower(auth.jwt() ->> 'email') like '%@myrcs.ca');
