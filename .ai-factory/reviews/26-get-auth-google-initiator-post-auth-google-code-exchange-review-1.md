# Code Review: GET /auth/google initiator + POST /auth/google code exchange

**Reviewed diff:** `src/users/controller/google-callback.controller.ts`, `src/users/dto/google-code-exchange.dto.ts`, `.env`, `.env.dev`, `.env.prod` (config-only changes for `WEB_REDIRECT_URI` + `FRONTEND_URL`).

**Risk Level:** 🟢 Low — implementation matches the plan and reuses the existing service path. No correctness bugs blocking ship. Two security-hygiene findings worth resolving before exposing the endpoint publicly.

---

## Verified-correct items

- **Routing.** `GET /auth/google`, `POST /auth/google`, and the pre-existing `GET /auth/google/callback` are three distinct method+path pairs under `@Controller('auth')`. No route shadowing.
- **DI wiring.** `AuthService` and `GoogleCallbackController` both live in `AuthModule` (`src/users/auth.module.ts:14, 43-44`). No new export needed; no circular dependency introduced.
- **Service reuse.** `POST /auth/google` calls `this.authService.signInWithGoogle(dto.code, dto.language, dto.redirectUri)` — the same path used by `AuthGrpcController.googleAuth` (`src/users/auth.grpc.controller.ts:65-72`). `AuthService.signInWithGoogle` (`src/users/service/auth.service.ts:51-96`) forwards `redirectUri` into `GoogleTokenService.exchangeCodeForProfile`, which switches on `isBrowserFlow = !!redirectUri` and calls `client.getToken({ code, redirect_uri })` — correct browser-flow path.
- **TS strictness.** `tsconfig.json` enables `strictNullChecks` only, not `strictPropertyInitialization`, so the non-initialized DTO fields `code: string` and `redirectUri: string` will not fail compilation. This matches the existing `GoogleAuthDto` shape.
- **Validation.** `main.ts:80-85` configures `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true, transform: true` — `GoogleCodeExchangeDto`'s decorators will run; extra body fields will be rejected with 400.
- **Response shape.** `@HttpCode(HttpStatus.OK)` on `POST /auth/google` matches the sibling `POST /auth/verify-code` (`src/users/controller/auth.rest.controller.ts:18-22`), returning `AuthResponseDto` 200.
- **Rules compliance.** No `!` non-null assertion anywhere; no logging of `dto.code` or `dto.redirectUri`.
- **Env-file parsing.** dotenv 17 (per `package-lock.json`) strips inline comments after a space, so `WEB_REDIRECT_URI=https://...callback # TODO: ...` resolves to the URL portion without the trailing comment. The pattern is consistent with the existing `APP_BASE_URL=https://dev.mind-awake.life #deeplink` entry.
- **Error propagation.** `signInWithGoogle` lets `UnauthorizedException` from `GoogleTokenService` propagate (token exchange failure → 401). DB failures inside the transaction surface as 500. Matches `POST /auth/verify-code` behavior.
- **CORS alignment.** `.env`, `.env.dev`, `.env.prod` now set `FRONTEND_URL` to the same origin as `WEB_REDIRECT_URI`, so `app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true })` in `src/main.ts:87-91` will accept the cross-origin POST from `mind_web`.

---

## Findings

### 1. 🟡 `GET /auth/google` issues no OAuth `state` parameter — CSRF / login-CSRF exposure (security)

**File:** `src/users/controller/google-callback.controller.ts:49-62`

The initiator builds the Google authorization URL with only `client_id`, `redirect_uri`, `response_type`, and `scope`. There is no `state` parameter and no companion cookie that the `mind_web` callback page verifies.

Without a `state` round-trip an attacker can complete the OAuth dance on their own client and feed the resulting `code` to a victim's browser (login-CSRF), or strip/replay the redirect. The OAuth 2.0 spec (RFC 6749 §10.12) and Google's own guidance flag this as **required** for authorization-code clients that don't use PKCE.

The plan's milestone description doesn't mention `state` and the review accepts this as out of scope, but flagging here because:

- The endpoint is going on the public internet behind a stable URL.
- Adding `state` is a one-paragraph change: generate a random nonce, set it as an `HttpOnly`/`SameSite=Lax` cookie scoped to `/auth/google`, include it in the redirect, have `mind_web` echo it back when calling `POST /auth/google`, and reject mismatches server-side.
- The mobile flow gets away without `state` because the OAuth code is delivered to the native app via a universal link — the browser flow doesn't have that property.

**Recommendation:** Either implement `state`/PKCE in a follow-up milestone before exposing the endpoint to real users, or explicitly document in `docs/auth/google-auth.md` that the web flow accepts unbound codes by design.

### 2. 🟡 `POST /auth/google` accepts any `redirectUri` matching `^https?://` — server has no allow-list (security, defense-in-depth)

**File:** `src/users/dto/google-code-exchange.dto.ts:8-13`, `src/users/controller/google-callback.controller.ts:64-74`

The DTO validates `redirectUri` only against `/^https?:\/\//`. The server never compares the supplied value against the configured `WEB_REDIRECT_URI`. Practical implications:

- Functionally safe today because Google's token endpoint rejects `redirect_uri` values that aren't registered in Cloud Console — so a code obtained via flow A cannot be exchanged with `redirect_uri` from flow B.
- However, the server will happily forward arbitrary attacker-supplied strings into `client.getToken({ redirect_uri })`. If a future operator adds extra redirect URIs to the Google client (e.g. for staging tooling), they widen this endpoint's trust boundary without realizing it.

**Recommendation (cheap hardening):** in `exchangeGoogleCode`, fetch `this.configService.getOrThrow<string>('WEB_REDIRECT_URI')` and reject the request with `BadRequestException` if `dto.redirectUri !== configured`. The web app already POSTs `window.location.origin + '/auth/google/callback'` which the operator controls. This makes the server contract self-enforcing rather than relying on Cloud Console hygiene.

### 3. 🟢 `.env.dev` and `.env.prod` carry placeholder web hosts behind `# TODO:` comments (operational)

**Files:** `.env.dev:31, 34`, `.env.prod:31, 34`

Both env files contain `# TODO: set to dev/prod mind_web host` annotations on `WEB_REDIRECT_URI` and `FRONTEND_URL`. The values shown (`https://web.dev.mind-awake.life`, `https://web.mind-awake.life`) are best-guess placeholders. dotenv inline-comment handling means the runtime values are clean URLs, so this is not a parsing bug — but if the actual deployed hosts differ, the dev/prod endpoint will return 500 (Google `redirect_uri_mismatch`) on the first real attempt, and CORS preflight will fail.

**Recommendation:** Before deploying dev/prod, confirm the real `mind_web` hostnames with the user, update both files, and register the URIs in Google Cloud Console. The local `.env` value (`http://localhost:5173`) is correct for Vite-default dev.

### 4. 🟢 `URLSearchParams` encodes the space in `scope` as `+` rather than `%20` (informational)

**File:** `src/users/controller/google-callback.controller.ts:54-60`

Already documented inline (and in plan-review-1 #3). Google's OAuth endpoint accepts both; no action.

### 5. 🟢 No log line in either new handler (informational)

**File:** `src/users/controller/google-callback.controller.ts:49-74`

Consistent with `.ai-factory/RULES.md` ("log errors and key business outcomes only") and the milestone's "minimal logging" setting. The existing `googleCallback` handler logs the relay outcome; the new handlers do not log success. Acceptable — `AuthService.signInWithGoogle` already logs `signInWithGoogle: existing user found / new user registered` outcomes, so the request is observable through that path.

---

## Runtime-break checklist

- ✅ No new migrations required (no DB changes).
- ✅ No proto changes (REST-only addition).
- ✅ No type mismatches: `signInWithGoogle(string, string?, string?)` matches `(dto.code, dto.language, dto.redirectUri)` exactly.
- ✅ No race conditions introduced — handlers are stateless; the underlying transaction in `signInWithGoogle` already uses `setLock('pessimistic_write')` on user lookup.
- ✅ No new modules to register in `AppModule`.
- ⚠️ Operational dependency: Google Cloud Console must list `WEB_REDIRECT_URI` per env. If absent at runtime, `POST /auth/google` returns 401 with the underlying `redirect_uri_mismatch` message from `GoogleTokenService`. Surface this to the operator before flipping the feature on for users.

---

## Verdict

Implementation is faithful to the plan, correctly delegates to existing services, and passes static analysis. Findings #1 and #2 are security hygiene that should be addressed before the web flow is exposed publicly but do not block merge of this scoped milestone. Finding #3 is operational and requires user input to resolve (real hostnames).
