# Plan: Relay OAuth `state` through Google sign-in flow (backend half)

## Context
Make the backend a transparent relay for the OAuth `state` parameter across `GET /auth/google`, the callback, and the `POST /auth/google` exchange, so the SPA can implement login-CSRF protection. The backend never validates `state`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Relay `state`

- [x] **Task 1: Relay `state` into the Google auth redirect**
  Files: `src/users/controller/google-callback.controller.ts`
  In `startGoogleOAuth`, add a `@Query('state') state?: string` parameter (the method signature already takes `@Res() res`). Include `state` in the `URLSearchParams` only when present — e.g. spread `...(state ? { state } : {})` into the params object passed to `new URLSearchParams({...})`. Leave `client_id`, `redirect_uri`, `response_type`, `scope` and the rest of the method unchanged.

- [x] **Task 2: Relay `state` back through the callback redirect** (depends on Task 1)
  Files: `src/users/controller/google-callback.controller.ts`
  In `googleCallback`, capture `@Query('state') state?: string`. Build the SPA relay redirect query with `URLSearchParams` for consistent encoding instead of manual `?googleError=`/`?googleCode=` string concatenation: construct a `URLSearchParams`, set `googleError` (on the error/missing-code branch) or `googleCode` (on the success branch), and append `state` when present. Redirect to `${baseUrl}${callbackPath}?${params.toString()}`. Preserve existing behavior: the warn log on error, the success log, and the `error || !code` branch logic.

- [x] **Task 3: Accept optional `state` on the exchange DTO** (depends on Task 2)
  Files: `src/users/dto/google-code-exchange.dto.ts`
  Add an optional `state` field to `GoogleCodeExchangeDto`: `@IsString() @IsOptional() state?: string`. This exists only so the POST body passes `forbidNonWhitelisted` validation — do not read or validate it anywhere, and do not touch `exchangeGoogleCode` / `signInWithGoogle` / the `redirectUri` allow-list check.
