# Code Review — Area 3: Web Dashboard REST API (Phases 21, 23)

**Date:** 2026-05-31
**Source:** conversation context (full code read)

## Scope

- **Phase 21** — `AuthRestController` (send-code/verify-code), Google OAuth initiator + code exchange (`GoogleCallbackController`), `SessionsModule` + `GET /sessions/runs` + `:id/biometrics` + `:id/instructions`, `GET /nfb-calibrations`
- **Phase 23** — enrich `GET /sessions/runs` with `activityType` / `description` / `complexity` (queryBuilder + left-join `breath_sessions`)

## Key Findings

- **Strong, defensive implementation overall.** Global `ValidationPipe` (`whitelist + forbidNonWhitelisted + transform`) is active in `main.ts:79`, so all query/body DTOs are enforced. `:id` routes use `ParseUUIDPipe` + service-layer ownership check. Time-range endpoints use a padded `flushedAt` coarse filter + exact per-sample timestamp trim + `ROW_CAP`/`FLAT_CAP` → `413 PayloadTooLarge`. OAuth `redirectUri` is pinned to `WEB_REDIRECT_URI`.
- **MEDIUM (security): Google OAuth flow has no `state` parameter** → login-CSRF risk. See Details.
- LOW/INFO observations below — none functional-blocking.

## Details

### MEDIUM — missing OAuth `state` (login CSRF)
`GoogleCallbackController.startGoogleOAuth` builds the Google auth URL with `client_id`, `redirect_uri`, `response_type`, `scope` — **no `state`**. The callback relays `code` to `APP_BASE_URL/auth/google/callback?googleCode=…`, and the SPA POSTs it to `/auth/google` for exchange. With no `state` bound to the initiating browser session, an attacker can feed a victim a callback URL carrying the attacker's own auth code; if the SPA auto-exchanges, the victim is silently logged into the attacker's account (classic OAuth login-CSRF). Mitigation: generate a random `state`, store it in an HttpOnly cookie / session at initiation, and verify it on the SPA side (or server side) before exchange. The `redirectUri` allow-list (`exchangeGoogleCode` rejects mismatches) is good and already blocks code-interception via rogue redirect URIs, but does not address CSRF.

### LOW / INFO — public auth endpoints, no throttling
`POST /auth/send-code` and `POST /auth/verify-code` are public (by design). `sendCode` has a per-email cooldown (`COOLDOWN_SECONDS`) guarding email-bombing, but `verifyCode` has **no per-email attempt lockout** and there is **no global ThrottlerGuard** (no `@nestjs/throttler` wired). The OTP is hashed and single-active-per-email with an expiry, but within the expiry window an attacker can script repeated guesses against the HTTP endpoint. Pre-existing (the gRPC auth path shares the same service), but the REST surface makes it trivially scriptable. Recommend a throttle on these two routes and/or a per-email failed-attempt counter that invalidates the code after N misses.

### LOW / INFO — `GET /nfb-calibrations` returns raw entities
`NfbCalibrationRestController.list` returns the `NfbCalibrationRecord` entities verbatim (`{ records, total }`), so the JSON includes the caller's own `userId`. Not a cross-user leak (records are scoped to `user.sub`) and exposing one's own id is harmless, but it is inconsistent with the gRPC mapper `toProtoNfbCalibrationRecord`, which omits `userId`. Cosmetic.

### Confirmed-correct details
- `SessionsService.listRuns` (Phase 23): `getCount()` on the unpaginated query for `total`, then `getRawAndEntities()` with `take/skip` for index-aligned `entities`/`raw`. Left-join condition `bs.id = ms."activityRefId" AND ms."activityType" = :breath AND bs."deletedAt" IS NULL` correctly yields null description/complexity for meditation sessions (a meditation `activityRefId` can never match a breath row). `complexity: Number(r.bs_complexity)` coerces the Postgres-string numeric. `entity.endedAt!` is safe under the `endedAt IS NOT NULL` filter. `take` capped at 200.
- `assertSessionOwnership` intentionally does **not** require `endedAt IS NOT NULL` (in-flight sessions are queryable for the live dashboard) — documented; UUID non-guessability + `userId` match is the boundary. `:id` is `ParseUUIDPipe`-validated.
- Biometrics/instructions flattening: defensive skip of samples lacking a numeric `timestamp`, exact `[from, to)` half-open trim, final sort by timestamp. `TimeRangeQueryDto` enforces `IsISO8601`, so malformed dates are rejected at the pipe (no Invalid-Date reaching `new Date()`).
- `GoogleCodeExchangeDto` validates `redirectUri` as an http(s) URL AND the controller pins it to `WEB_REDIRECT_URI`. `SessionsModule`/`AuthRestController`/`GoogleCallbackController` all registered; `AuthCodeService` exported; `signInWithGoogle` exists.

## Open Questions

- Add OAuth `state` now (security hardening) — in scope for this review's follow-up, or a separate ticket?
- Should the public auth REST routes get an explicit throttle, given the pre-existing OTP brute-force surface is now HTTP-exposed?
