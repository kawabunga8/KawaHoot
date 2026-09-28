-- Claiming a roster name has failed since 20260901 ("Tighten RLS"): the anonymous
-- UPDATE policy had USING (is_claimed = false) and no WITH CHECK, so Postgres applied
-- the USING expression to the new row too, and /api/game/claim-player's
-- "is_claimed = true" was always rejected (new row violates row-level security). The
-- player page carried on regardless, so the name stayed unclaimed: the host saw
-- "0/N joined", Start stayed blocked on "Waiting for N students", and a second device
-- could pick the same name.
--
-- The old row must still be unclaimed (USING, unchanged), so a name can be claimed once
-- and a claimed row can't be taken over. The new row may be claimed, but never
-- identity-verified: only the server's auto-claim does that (players_guard_identity).
-- Anonymous updates also may not touch score, team, game or roster status. The only
-- anonymous updates are claim-player (nickname, is_claimed, real_name) and
-- identify-player (a guest's nickname); points come from /api/game/answer (service
-- role) and teams from host routes.

alter policy "Anonymous can only update an unclaimed player" on public.players
  using (is_claimed = false)
  with check (identity_verified = false);

create or replace function public.players_guard_anon_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- current_user is the database role the request runs as (anon for players with no
  -- session); unlike auth.role() it doesn't depend on JWT claims being present.
  if current_user = 'anon'
     and (new.score, new.team_id, new.game_id, new.is_pre_registered)
         is distinct from (old.score, old.team_id, old.game_id, old.is_pre_registered) then
    raise exception 'players may only change their name and claim status' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.players_guard_anon_update() from public, anon, authenticated;
drop trigger if exists players_guard_anon_update on public.players;
create trigger players_guard_anon_update before update on public.players
  for each row execute function public.players_guard_anon_update();
