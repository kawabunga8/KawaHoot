-- kawahoot_classes / kawahoot_students held the ad-hoc class lists (names) and had
-- "Allow all ... USING (true) WITH CHECK (true)" policies for EVERY role, so anyone
-- holding the (public) publishable key could read, add, rename or delete them.
--
-- The host page (src/app/host/page.tsx) edits them straight from the browser with the
-- host's own signed-in session, and /api/classes reads them with the service role
-- (which bypasses RLS). So the right rule is: signed-in @myrcs.ca hosts only.
--
-- NOTE: this is only as strong as "who can get a session with an @myrcs.ca email".
-- Keep new sign-ups closed or confirmed (config.toml [auth] / [auth.email]).
drop policy if exists "Allow all on kawahoot_classes" on public.kawahoot_classes;
drop policy if exists "Allow all on kawahoot_students" on public.kawahoot_students;

create policy "Hosts manage classes" on public.kawahoot_classes
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') like '%@myrcs.ca')
  with check (lower(auth.jwt() ->> 'email') like '%@myrcs.ca');

create policy "Hosts manage class students" on public.kawahoot_students
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') like '%@myrcs.ca')
  with check (lower(auth.jwt() ->> 'email') like '%@myrcs.ca');
