-- VertexLab Cloud Sync — Snapshot actualizado del esquema de base de datos.
-- Este archivo representa el estado completo y actual de la base de datos en Supabase.
-- Para aplicar cambios incrementales, usar los archivos en supabase/migrations/.

create schema if not exists private;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Perfil de cuenta VertexLab (identidad separada de Google Drive)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  drive_connected boolean not null default false,
  drive_email text,
  drive_root_folder_id text,
  drive_root_folder_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Tokens cifrados de Google Drive (esquema privado, accesible solo vía service_role / Edge Functions)
create table if not exists private.drive_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  token_iv text not null,
  scope text not null default 'https://www.googleapis.com/auth/drive.file',
  drive_email text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_drive_tokens_updated_at on private.drive_tokens;
create trigger trg_drive_tokens_updated_at
  before update on private.drive_tokens
  for each row execute function public.set_updated_at();

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- Índice ligero de sesiones sincronizadas en Google Drive (almacenamiento por componentes)
create table if not exists public.cloud_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[0-9a-f]{32}$'),
  name text not null check (char_length(name) <= 256),
  car_ordinal integer not null default 0,
  car_name text,
  car_class integer,
  car_pi integer,
  brand text,
  created_epoch double precision not null,
  ended_epoch double precision,
  duration double precision,
  version integer not null default 2 check (version in (1, 2)),
  featured boolean not null default false,
  sync_offset double precision not null default 0,
  preview jsonb,
  drive_folder_id text not null,
  drive_meta_file_id text not null,
  drive_telemetry_file_id text not null,
  telemetry_size bigint not null default 0 check (telemetry_size >= 0),
  telemetry_encoding text not null default 'gzip' check (telemetry_encoding in ('gzip', 'plain')),
  drive_video_file_id text,
  video_size bigint check (video_size is null or video_size > 0),
  video_mime text,
  video_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists idx_cloud_sessions_library
  on public.cloud_sessions (user_id, created_epoch desc, id asc);

drop trigger if exists trg_cloud_sessions_updated_at on public.cloud_sessions;
create trigger trg_cloud_sessions_updated_at
  before update on public.cloud_sessions
  for each row execute function public.set_updated_at();

alter table public.cloud_sessions enable row level security;

drop policy if exists "cloud_sessions_select_own" on public.cloud_sessions;
create policy "cloud_sessions_select_own"
  on public.cloud_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "cloud_sessions_insert_own" on public.cloud_sessions;
create policy "cloud_sessions_insert_own"
  on public.cloud_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "cloud_sessions_update_own" on public.cloud_sessions;
create policy "cloud_sessions_update_own"
  on public.cloud_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cloud_sessions_delete_own" on public.cloud_sessions;
create policy "cloud_sessions_delete_own"
  on public.cloud_sessions for delete
  using (auth.uid() = user_id);
