# Web Dashboard — REST API Requirements

**Date:** 2026-05-29
**Source:** conversation context

## Key Findings

- All existing auth endpoints are gRPC-only (mobile transport). The web dashboard needs REST wrappers for `send-code`, `verify-code`, and Google Sign-In.
- The magic link in email (`{APP_BASE_URL}/deeplink-auth?code=<code>`) already works for web — no template changes needed. On mobile it opens as a native deeplink; in a browser it hits the web app's `/deeplink-auth` route. `APP_BASE_URL` differs between dev/prod but is a single value per environment.
- Google OAuth: the existing OAuth client is Web application type (confirmed by `GOOGLE_CLIENT_SECRET`). No new client needed — just add `{APP_BASE_URL}/auth/google/callback` to the authorized redirect URIs in Google Cloud Console.
- Four new read-only REST endpoints are needed for historical session data (`/sessions/runs`, biometrics, instructions, NFB calibrations).

## Details

### New REST auth endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /auth/send-code` | REST wrapper over existing `SendCode` gRPC logic. Body: `{ email, locale? }`. Returns `{ message }`. Reuses same service, cooldown, rate-limit. |
| `POST /auth/verify-code` | REST wrapper over `VerifyCode`. Body: `{ email, code }`. Returns `{ token, user }`. |
| `GET /auth/google` | Initiates browser OAuth. Constructs Google OAuth URL using `GOOGLE_CLIENT_ID` + `WEB_REDIRECT_URI` env var, redirects browser to Google. |
| `POST /auth/google` | REST counterpart to `GoogleAuth` gRPC. Body: `{ code, redirectUri }`. Exchanges code, returns `{ token, user }`. |

New env var: `WEB_REDIRECT_URI` — value `{APP_BASE_URL}/auth/google/callback`. Register this in Google Cloud Console for the existing Web application OAuth client.

### Magic link — no API changes needed

The existing email template already has `{APP_BASE_URL}/deeplink-auth?code=<code>`. The web app registers `/deeplink-auth` as a route and handles the code on mount:
1. Read `?code=` from URL
2. Read `mind_pending_email` from `localStorage` (stored when the user submitted send-code)
3. Call `POST /auth/verify-code { email, code }` → login
4. If no pending email in storage: show a short email input before verifying

### Google OAuth flow (browser)

The existing `GET /auth/google/callback` relay is already in place. Full flow:
1. Web clicks "Continue with Google" → `GET /auth/google` → API redirects to Google
2. Google redirects to `GET /auth/google/callback?code=...` on the API
3. API relays to `{APP_BASE_URL}/auth/google/callback?googleCode=<code>` (success) or `?googleError=<err>`
4. Web app reads `googleCode`, calls `POST /auth/google { code, redirectUri }` → receives JWT

### New read-only data endpoints

All protected by `JwtAuthGuard` + `@CurrentUser()`, scoped to authenticated user's data.

| Endpoint | Source table | Notes |
|----------|-------------|-------|
| `GET /sessions/runs?limit=50&offset=0` | `module_sessions` | Completed sessions only (`ended_at IS NOT NULL`), ordered `started_at DESC`. Response: `{ id, startedAt, endedAt, durationSeconds }[]` |
| `GET /sessions/runs/:id/biometrics` | `bio_session_samples` | Ownership check via join to `module_sessions`. Flatten `samples` jsonb arrays → flat `{ timestamp, sampleType, data }[]` |
| `GET /sessions/runs/:id/instructions` | `session_stream_samples` | Same ownership check + flattening → flat `{ timestamp, type, payload }[]` |
| `GET /nfb-calibrations?deviceSerial=` | `nfb_calibration_records` | All 13 entity fields, ordered `created_at DESC`, optional device filter |

## Open Questions

- Are `module_sessions` and `session_stream_samples` already accessible from `BreathSessionsModule`, or do they need a new dedicated module?
