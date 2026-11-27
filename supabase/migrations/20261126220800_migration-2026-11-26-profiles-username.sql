-- Migration: 2026-11-26-003 — Add unique case-insensitive username to public.profiles

alter table public.profiles
  add column if not exists username text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-zA-Z0-9._-]{3,24}$');
  end if;
end $$;

create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(username))
  where username is not null;
