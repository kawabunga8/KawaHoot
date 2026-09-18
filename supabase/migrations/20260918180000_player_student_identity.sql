-- Project: KawahootCA (earkqfpgcglrrfwcdudo).
-- KawaHoot moved to its own project on 2026-08-06, but players.student_id was
-- left behind in the shared project. Since then pre_register has failed on the
-- missing column and no player has been linked to a student.
--
-- student_id holds a Course Hub student id (public.students.id in the shared
-- project). No foreign key: that table lives in another database.
-- identity_verified is true only when the server confirmed the student's
-- sign-in (auto-claim). Picking a name from the roster is honour-system and
-- stays false. Only verified players may feed the learning record (course-hub
-- ADR-0001).
alter table public.players
  add column if not exists student_id uuid,
  add column if not exists identity_verified boolean not null default false;
create index if not exists players_game_student_idx on public.players (game_id, student_id);

-- Browsers use the publishable key, and anon may insert and update unclaimed
-- players. Only the server (service role) may set identity.
create or replace function public.players_guard_identity() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.student_id := null;
      new.identity_verified := false;
    elsif new.student_id is distinct from old.student_id
       or new.identity_verified is distinct from old.identity_verified then
      raise exception 'student identity can only be set by the server' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.players_guard_identity() from public, anon, authenticated;
drop trigger if exists players_guard_identity on public.players;
create trigger players_guard_identity before insert or update on public.players
  for each row execute function public.players_guard_identity();
