-- Migration: 2026-11-26-002 — Service-role-only RPC helpers for private.drive_tokens
-- Keeps the `private` schema unexposed in PostgREST while allowing Edge Functions
-- authenticated with service_role to read/write/delete encrypted refresh tokens.

create or replace function public.upsert_drive_token(
  p_user_id uuid,
  p_encrypted text,
  p_iv text,
  p_scope text,
  p_drive_email text
)
returns void
language plpgsql
security definer
set search_path = private, public
as $$
begin
  insert into private.drive_tokens (user_id, encrypted_refresh_token, token_iv, scope, drive_email)
  values (p_user_id, p_encrypted, p_iv, coalesce(p_scope, 'https://www.googleapis.com/auth/drive.file'), p_drive_email)
  on conflict (user_id) do update set
    encrypted_refresh_token = excluded.encrypted_refresh_token,
    token_iv = excluded.token_iv,
    scope = excluded.scope,
    drive_email = excluded.drive_email,
    updated_at = now();
end;
$$;

create or replace function public.get_drive_token(p_user_id uuid)
returns table (
  encrypted_refresh_token text,
  token_iv text,
  drive_email text
)
language sql
security definer
set search_path = private, public
as $$
  select dt.encrypted_refresh_token, dt.token_iv, dt.drive_email
  from private.drive_tokens dt
  where dt.user_id = p_user_id;
$$;

create or replace function public.delete_drive_token(p_user_id uuid)
returns void
language sql
security definer
set search_path = private, public
as $$
  delete from private.drive_tokens where user_id = p_user_id;
$$;

revoke all on function public.upsert_drive_token(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_drive_token(uuid) from public, anon, authenticated;
revoke all on function public.delete_drive_token(uuid) from public, anon, authenticated;

grant execute on function public.upsert_drive_token(uuid, text, text, text, text) to service_role;
grant execute on function public.get_drive_token(uuid) to service_role;
grant execute on function public.delete_drive_token(uuid) to service_role;
