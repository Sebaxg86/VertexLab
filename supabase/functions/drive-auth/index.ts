// Supabase Edge Function: drive-auth
// Exchanges Google Drive OAuth codes, stores refresh tokens encrypted (AES-256-GCM)
// in private.drive_tokens, and mints short-lived Drive access tokens for any device
// signed into the same VertexLab account.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function allowedOrigin(origin: string | null): string {
  if (!origin) return '*';
  const extra = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ||
    origin === 'https://sebaxg86.github.io' ||
    extra.includes(origin)
  ) {
    return origin;
  }
  return 'https://sebaxg86.github.io';
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(origin),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importSecretKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('DRIVE_TOKEN_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('DRIVE_TOKEN_SECRET is not configured');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptToken(plaintext: string): Promise<{ cipher: string; iv: string }> {
  const key = await importSecretKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { cipher: toBase64(new Uint8Array(encrypted)), iv: toBase64(iv) };
}

async function decryptToken(cipher: string, iv: string): Promise<string> {
  const key = await importSecretKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(cipher),
  );
  return new TextDecoder().decode(decrypted);
}

async function fetchDriveEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(GOOGLE_ABOUT_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.user?.emailAddress ?? null;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!supabaseUrl || !anonKey || !serviceKey || !googleClientId || !googleClientSecret) {
    return jsonResponse({ error: 'Cloud Drive auth service is not fully configured' }, 500, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Inicia sesión en VertexLab para continuar' }, 401, origin);
  }
  const jwt = authHeader.slice('Bearer '.length).trim();
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    console.error('drive-auth getUser failed:', userError?.message);
    return jsonResponse(
      { error: 'Sesión de VertexLab inválida o expirada' + (userError?.message ? ': ' + userError.message : '') },
      401,
      origin,
    );
  }
  const userId = userData.user.id;

  async function readStoredToken() {
    const { data, error } = await admin.rpc('get_drive_token', { p_user_id: userId });
    if (error) throw error;
    return Array.isArray(data) ? data[0] ?? null : data ?? null;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400, origin);
  }

  const action = String(body.action || '');

  try {
    if (action === 'exchange') {
      const code = String(body.code || '');
      const redirectUri = String(body.redirectUri || '');
      const codeVerifier = body.codeVerifier ? String(body.codeVerifier) : '';
      if (!code || !redirectUri) {
        return jsonResponse({ error: 'Faltan parámetros de autorización de Google Drive' }, 400, origin);
      }

      const params = new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      if (codeVerifier) params.set('code_verifier', codeVerifier);

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        return jsonResponse(
          { error: tokenData.error_description || 'Google rechazó la autorización de Drive' },
          400,
          origin,
        );
      }

      let refreshToken = tokenData.refresh_token ? String(tokenData.refresh_token) : '';
      if (!refreshToken) {
        const existing = await readStoredToken();
        if (!existing) {
          return jsonResponse(
            {
              error: 'Google no entregó permiso sin conexión. Vuelve a conectar Google Drive aceptando el acceso.',
              code: 'MISSING_REFRESH_TOKEN',
            },
            400,
            origin,
          );
        }
        refreshToken = await decryptToken(existing.encrypted_refresh_token, existing.token_iv);
      }

      const driveEmail = await fetchDriveEmail(tokenData.access_token);
      const { cipher, iv } = await encryptToken(refreshToken);

      const { error: upsertError } = await admin.rpc('upsert_drive_token', {
        p_user_id: userId,
        p_encrypted: cipher,
        p_iv: iv,
        p_scope: String(tokenData.scope || DRIVE_SCOPE),
        p_drive_email: driveEmail,
      });
      if (upsertError) throw upsertError;

      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .update({ drive_connected: true, drive_email: driveEmail })
        .eq('id', userId)
        .select('drive_root_folder_id, drive_root_folder_name')
        .single();
      if (profileError) throw profileError;

      return jsonResponse(
        {
          connected: true,
          driveEmail,
          accessToken: tokenData.access_token,
          expiresIn: Number(tokenData.expires_in) || 3600,
          driveRootFolderId: profile?.drive_root_folder_id ?? null,
          driveRootFolderName: profile?.drive_root_folder_name ?? null,
        },
        200,
        origin,
      );
    }

    if (action === 'token') {
      const row = await readStoredToken();
      if (!row) {
        return jsonResponse(
          { error: 'Google Drive no está vinculado a esta cuenta', code: 'DRIVE_NOT_CONNECTED' },
          404,
          origin,
        );
      }

      const refreshToken = await decryptToken(row.encrypted_refresh_token, row.token_iv);
      const params = new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
      const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      const refreshData = await refreshRes.json();
      if (!refreshRes.ok || !refreshData.access_token) {
        if (refreshData.error === 'invalid_grant') {
          await admin.rpc('delete_drive_token', { p_user_id: userId });
          await admin
            .from('profiles')
            .update({ drive_connected: false, drive_email: null })
            .eq('id', userId);
          return jsonResponse(
            {
              error: 'El permiso de Google Drive expiró o fue revocado. Vuelve a vincular Google Drive.',
              code: 'DRIVE_RECONNECT_REQUIRED',
            },
            401,
            origin,
          );
        }
        return jsonResponse(
          { error: refreshData.error_description || 'No se pudo renovar el acceso a Google Drive' },
          502,
          origin,
        );
      }

      const { data: profile } = await admin
        .from('profiles')
        .select('drive_root_folder_id, drive_root_folder_name')
        .eq('id', userId)
        .maybeSingle();

      return jsonResponse(
        {
          connected: true,
          driveEmail: row.drive_email,
          accessToken: refreshData.access_token,
          expiresIn: Number(refreshData.expires_in) || 3600,
          driveRootFolderId: profile?.drive_root_folder_id ?? null,
          driveRootFolderName: profile?.drive_root_folder_name ?? null,
        },
        200,
        origin,
      );
    }

    if (action === 'folder') {
      const folderId = String(body.folderId || '').trim();
      const folderName = String(body.folderName || '').trim().slice(0, 128);
      if (!folderId || !/^[A-Za-z0-9_-]{8,128}$/.test(folderId)) {
        return jsonResponse({ error: 'ID de carpeta de Google Drive inválido' }, 400, origin);
      }
      const { error } = await admin
        .from('profiles')
        .update({
          drive_root_folder_id: folderId,
          drive_root_folder_name: folderName || 'VertexLab',
        })
        .eq('id', userId);
      if (error) throw error;
      return jsonResponse(
        { ok: true, driveRootFolderId: folderId, driveRootFolderName: folderName || 'VertexLab' },
        200,
        origin,
      );
    }

    if (action === 'disconnect') {
      const row = await readStoredToken();
      if (row) {
        try {
          const refreshToken = await decryptToken(row.encrypted_refresh_token, row.token_iv);
          await fetch(GOOGLE_REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refreshToken }),
          });
        } catch {
          // Best-effort revoke; always clear local token state.
        }
        await admin.rpc('delete_drive_token', { p_user_id: userId });
      }
      await admin
        .from('profiles')
        .update({
          drive_connected: false,
          drive_email: null,
          drive_root_folder_id: null,
          drive_root_folder_name: null,
        })
        .eq('id', userId);
      return jsonResponse({ connected: false }, 200, origin);
    }

    return jsonResponse({ error: 'Acción no reconocida' }, 400, origin);
  } catch (error) {
    console.error('drive-auth error:', error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Error interno de Drive Auth';
    return jsonResponse({ error: message }, 500, origin);
  }
});
