# Project Status (Feb 1, 2026)

## What the app does
- E-signature app with identity verification (Documenso + Didit).

## Multi-tenant configuration (current)
- Tenants: `tenants` table with `name`, `slug`, `id`.
- Membership: `tenant_users` with `tenant_id`, `user_id`, `role` (`tenant_admin|tenant_member`), `status`.
- Platform role: `profiles.role = 'platform_admin'`.
- Integrations are stored per tenant in `tenant_integrations` and resolved by the logged-in user's `tenant_id`.
- Document ownership is scoped by `documents.tenant_id` and fetched using the current user's `tenant_id`.
- Signer/verification flows resolve tenant using `documents.tenant_id` (passed to Documenso/Didit services).
- Admin UI at `/admin`:
  - **Platform admin**: list all tenants, create empty tenants, create tenants with admin user
  - **Tenant admin**: invite users by email (Supabase invite) and assign role per tenant
  - List users in tenant and change roles

## Visual Identity
- Emerald/teal + slate palette; TrustGate wordmark styling applied via `brand-wordmark`.

## Branding
- **Logo**: `/public/logo.png` used in sidebar, mobile header, and login page
- **Favicons**:
  - `/public/favicon.ico`
  - `/public/favicon-16x16.png`
  - `/public/favicon-32x32.png`
  - `/public/apple-touch-icon.png`
- **PWA manifest**: `/public/site.webmanifest`
- **Theme color**: `#10b981` (emerald-500)

## Pending
- Probar RLS con usuario `tenant_member` real (accesos a docs/usuarios/administración).
- Definir y asignar planes a tenants (plan_id) para métricas de uso y límites (docs/mes).

## Done
- Documenso API v2: multipart/form-data, recipients.fields, identifier=0, % coords.
- Documenso auth: raw api token (no Bearer).
- Signing: embedded `@documenso/embed-react` with recipient token.
- Didit verification via Edge Function `didit-proxy`.
- Didit auth: `x-api-key` header → `https://verification.didit.me/v2/session/`.
- SigningRoom: botón "Continuar Verificación" para usuarios que regresan.
- Documenso: create fields via `envelope/field/create-many` + `envelope/distribute` (document ready to sign).
- Didit webhooks: signature validation (V2/simple), `status.updated`/`data.updated`, in-review handling.
- SigningRoom: unified guided flow with step list, in-review status, and signing deadline info.
- RLS + roles: `platform_admin`, `tenant_admin`, `tenant_member`.
- Trazabilidad: `documents.created_by`, `documents.updated_by`, `audit_log.actor_id`.
- SignRoom via Edge Function `signing-room` (no realtime).
- Didit proxy fallback to signer token when JWT is invalid.
- Edit document now re-sella en Documenso: elimina envelope anterior, crea nuevo y registra audit.
- Admin users: editar `full_name` (profiles) y ver nombres en listados.
- Step 2 de firmantes rediseñado (tabla, rol dropdown, orden compacto).
- SMTP de invitaciones configurado con Resend (envío de emails OK).
- admin-users: manual JWT decode + verify_jwt=false.
- Rate limit fix: prevent duplicate `loadContext()`.
- Platform admin features: list/create tenants, create tenant+admin.
- Admin UI for platform admin (tenants list, create flows).
- Login page redesign (emerald gradient, glassmorphism).
- Branding integration (logo, favicons, PWA manifest).
- Carpetas por tenant (tabla folders + folder_id en documents, UI en Documentos, drag & drop, modal CRUD).
- Admin platform panel (UI corporativa, listado de tenants, activar/inactivar, métricas y filtros).
- Planes (tabla plans + plan_id en tenants) y métricas docs/mes/tenant + MRR en /admin.
- Cancelación de documentos (app + Documenso), bloqueo en Signing Room.
- Webhooks Didit: `webhook-didit` desplegado sin JWT; signing-room sin JWT.
