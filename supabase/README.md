# VertexLab Cloud Sync (Supabase + Google Drive)

Esta carpeta contiene la infraestructura de base de datos y la Edge Function para la sincronización en la nube de VertexLab:

- `schema.sql`: fotografía actualizada del esquema completo de la base de datos.
- `migrations/`: migraciones versionadas (`migration-YYYY-MM-DD-NNN-*.sql`) para llevar control de cambios incrementales.
- `functions/drive-auth/index.ts`: Edge Function que intercambia códigos OAuth de Google Drive (`drive.file`), guarda el `refresh_token` cifrado con AES-256-GCM en `private.drive_tokens` y entrega `access_token` temporales a cualquier dispositivo autenticado con la misma cuenta VertexLab.

## Despliegue en Supabase

1. Aplicar la migración inicial (SQL Editor o Supabase CLI):
   ```powershell
   supabase db push
   ```
   o ejecutar `supabase/migrations/migration-2026-11-26-001-initial-cloud-sync.sql` en el SQL Editor del proyecto.

2. Configurar secretos de la Edge Function:
   ```powershell
   supabase secrets set GOOGLE_CLIENT_ID="tu-client-id.apps.googleusercontent.com"
   supabase secrets set GOOGLE_CLIENT_SECRET="tu-client-secret"
   supabase secrets set DRIVE_TOKEN_SECRET="una-clave-aleatoria-de-al-menos-32-caracteres"
   supabase secrets set ALLOWED_ORIGINS="https://sebaxg86.github.io"
   ```

3. Desplegar la Edge Function:
   ```powershell
   supabase functions deploy drive-auth --no-verify-jwt
   ```
   *(La función valida manualmente el JWT de Supabase del encabezado `Authorization` y responde `OPTIONS` CORS correctamente.)*

## Google Cloud Console (OAuth)

- Crear credenciales **OAuth 2.0 Client ID** (tipo *Web application* para el visor y/o *Desktop* si se desea) con el scope `https://www.googleapis.com/auth/drive.file`.
- Agregar en *Authorized redirect URIs*:
  - `https://sebaxg86.github.io/VertexLab/` (y el dominio propio cuando se configure)
  - `http://127.0.0.1:8766/api/cloud/drive/callback`
  - `http://127.0.0.1:18773/api/cloud/drive/callback` (solo para pruebas aisladas)
- En **Supabase Auth → Providers → Google**, habilitar Google solo con perfil básico (`email`, `profile`) para crear la cuenta VertexLab de forma separada a Google Drive.
