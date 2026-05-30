# Plan: GET /auth/google initiator + POST /auth/google code exchange

## Context
Add two REST endpoints to the existing `GoogleCallbackController` so the `mind_web` dashboard can start the Google OAuth flow in the browser (`GET /auth/google` → 302 to Google) and exchange the authorization code for an `AuthResponseDto` (`POST /auth/google`). Reuses `AuthService.signInWithGoogle` (which already wraps `GoogleTokenService.exchangeCodeForProfile` + user upsert + JWT issue) — no new business logic.

**Architectural note (resolves plan-review-1 Critical #1).** The web `redirect_uri` MUST point at a URL that `mind_web` controls — not at the API host. The existing `GET /auth/google/callback` route on the API is the mobile deep-link relay (it 302s to `{APP_BASE_URL}/auth/google/callback?googleCode=…` so a universal link can intercept on-device). If the browser flow used the same URL, the browser would follow the relay 302 back to the API with `?googleCode=…` (no `code=`/`error=` params), hit the `if (error || !code)` branch in `googleCallback`, and the web app would never see the auth code. Therefore the browser flow must round-trip through a route hosted by `mind_web`, whose page-load reads `?code=` from `window.location` and POSTs it to the API's new `POST /auth/google`. This plan picks that URL via `WEB_REDIRECT_URI` per env.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Configuration

- [x] **Task 1: Add `WEB_REDIRECT_URI` env variable pointing at the `mind_web` host**
  Files: `.env`, `.env.dev`, `.env.prod`
  Append `WEB_REDIRECT_URI=<url>` to each file. The value must be a URL on the **`mind_web` host**, not `APP_BASE_URL` (which is the mobile deep-link host). Use the literal URL in each file — `@nestjs/config` does not interpolate shell-style variables. Place the new line near the existing `GOOGLE_CLIENT_ID` block for discoverability.
  - `.env` (local dev against Vite default port): `WEB_REDIRECT_URI=http://localhost:5173/auth/google/callback`
  - `.env.dev` (Docker dev): set to the dev-deployed mind_web host, e.g. `WEB_REDIRECT_URI=https://web.dev.mind-awake.life/auth/google/callback`. If the deployed dev host is not yet decided, use the localhost value as a placeholder and add a `# TODO: set to dev mind_web host` comment on the same line so the next operator notices.
  - `.env.prod`: set to the production mind_web host, e.g. `WEB_REDIRECT_URI=https://web.mind-awake.life/auth/google/callback`. Same TODO-comment convention if the prod host is not yet known.
  **Out-of-band prerequisites the implementer must surface to the user (do not silently skip):**
  1. Register every URI value used above in Google Cloud Console under the same OAuth client that owns `GOOGLE_CLIENT_ID` — otherwise Google rejects the redirect with `redirect_uri_mismatch`.
  2. Coordinate with `mind_web` to add a `/auth/google/callback` route that reads `?code=` from `window.location.search` and POSTs `{ code, redirectUri: window.location.origin + '/auth/google/callback' }` to the API's new `POST /auth/google` endpoint, then stores the returned `accessToken` and navigates the user into the app. The exact `redirectUri` string the web app POSTs MUST match the `WEB_REDIRECT_URI` value the API used when generating the Google URL, or `GoogleTokenService.exchangeCodeForProfile` will fail.

### Phase 2: DTO

- [x] **Task 2: Create `GoogleCodeExchangeDto`**
  Files: `src/users/dto/google-code-exchange.dto.ts`
  New class-validator DTO for the `POST /auth/google` body. Fields:
  - `code: string` — `@IsString() @IsNotEmpty()`
  - `redirectUri: string` — `@IsString() @IsNotEmpty() @Matches(/^https?:\/\//, { message: 'redirectUri must be an http(s) URL' })` (regex intentionally allows `http://` so local dev against `http://localhost:5173/...` works; production hosts will still use `https://`)
  - `language?: string` — `@IsString() @IsOptional()` (matches the existing `GoogleAuthDto` shape in `src/users/dto/google-auth.dto.ts`)

### Phase 3: Controller endpoints

- [x] **Task 3: Inject `AuthService` into `GoogleCallbackController`** (depends on Task 1)
  Files: `src/users/controller/google-callback.controller.ts`
  Extend the constructor to also receive `private readonly authService: AuthService` (import from `../service/auth.service`). Keep the existing `ConfigService` injection — both new endpoints need it. Do not pre-read env values in the constructor; read with `configService.getOrThrow<string>(...)` inside each handler to keep behavior consistent with the existing `googleCallback` method. Use the existing `Logger` instance for any new log lines (errors / outcomes only, no sensitive data — follow `.ai-factory/RULES.md`). No `AuthModule` changes are required — `AuthService` is already a provider and `GoogleCallbackController` is already declared in `controllers` (`src/users/auth.module.ts:43-44`).

- [x] **Task 4: Implement `GET /auth/google` initiator** (depends on Task 3)
  Files: `src/users/controller/google-callback.controller.ts`
  Add a new handler:
  ```ts
  @Get('google')
  startGoogleOAuth(@Res() res: Response): void { ... }
  ```
  Inside:
  1. `const clientId = this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');`
  2. `const redirectUri = this.configService.getOrThrow<string>('WEB_REDIRECT_URI');`
  3. Build the URL with `URLSearchParams` for correct percent-encoding:
     ```ts
     const params = new URLSearchParams({
       client_id: clientId,
       redirect_uri: redirectUri,
       response_type: 'code',
       scope: 'openid email profile',
     });
     const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
     ```
     Note: `URLSearchParams` encodes the space in `scope` as `+` rather than `%20`. Google accepts both (see plan-review-1 #3) — no action needed.
  4. `res.redirect(302, url);`
  Do not add `access_type=offline` — the milestone does not request refresh tokens.

- [x] **Task 5: Implement `POST /auth/google` code exchange** (depends on Tasks 2, 3)
  Files: `src/users/controller/google-callback.controller.ts`
  Add a new handler:
  ```ts
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async exchangeGoogleCode(@Body() dto: GoogleCodeExchangeDto): Promise<AuthResponseDto> { ... }
  ```
  Imports to add: `Body`, `Post`, `HttpCode`, `HttpStatus` from `@nestjs/common`; `AuthResponseDto` from `../dto/auth-response.dto`; `GoogleCodeExchangeDto` from `../dto/google-code-exchange.dto`.
  Implementation: delegate directly to the existing service path already used by `AuthGrpcController.googleAuth` (see `src/users/auth.grpc.controller.ts:65-72`):
  ```ts
  return this.authService.signInWithGoogle(dto.code, dto.language, dto.redirectUri);
  ```
  Do not duplicate the find-or-create-user / JWT logic — `AuthService.signInWithGoogle` (`src/users/service/auth.service.ts`) already calls `GoogleTokenService.exchangeCodeForProfile(code, redirectUri)` and returns `AuthResponseDto`. Do not catch errors — let `UnauthorizedException` from `GoogleTokenService` propagate so NestJS returns 401, matching `POST /auth/verify-code` behavior. Per `.ai-factory/RULES.md`: never log `dto.code` or `dto.redirectUri`; if any log line is added, log outcome only. Do not use the `!` non-null operator.

## Notes

- No changes needed in `AuthModule` — `AuthService` is already declared in `providers` and `GoogleCallbackController` is already declared in `controllers` (`src/users/auth.module.ts:43-44`).
- The existing `GET /auth/google/callback` handler MUST remain untouched — it serves the mobile deep-link relay flow.
- All three endpoints (existing `GET /auth/google/callback`, new `GET /auth/google`, new `POST /auth/google`) share the `@Controller('auth')` prefix on the class. They are three distinct method+path combinations and do not conflict.
- **CORS prerequisite.** `POST /auth/google` will be called cross-origin from the `mind_web` host. Global CORS is configured in `src/main.ts:87-91` as `origin: process.env.FRONTEND_URL || 'http://localhost:8000'` (single-origin string, not an allow-list). Before the implementer ships, confirm `FRONTEND_URL` is set per env to the same host registered in `WEB_REDIRECT_URI`:
  - `.env` (local dev): `FRONTEND_URL=http://localhost:5173`
  - `.env.dev` / `.env.prod`: match the deployed `mind_web` host.
  If multiple origins must be allowed (e.g. landing + web dashboard), the CORS config in `src/main.ts` needs to be widened to an allow-list — that change is **out of scope for this milestone**; flag it to the user instead of expanding scope silently.
- **Out-of-band coordination (also listed in Task 1).** Google Cloud Console must have every `WEB_REDIRECT_URI` value registered as an authorized redirect URI on the same OAuth client. The `mind_web` repo must add a `/auth/google/callback` route that POSTs `{ code, redirectUri }` to this endpoint with `redirectUri` exactly equal to the API's `WEB_REDIRECT_URI` value for that environment.

<!-- orchestrator-sessions
planner: ba7c7e3f-a91c-4a38-bea1-46c5b8afb006
elapsed: 1094
implementer: ada47334-eb98-4147-8b83-a602f6d584bd
-->
