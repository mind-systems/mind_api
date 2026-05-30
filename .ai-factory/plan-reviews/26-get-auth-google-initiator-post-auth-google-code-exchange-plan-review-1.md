# Plan Review: GET /auth/google initiator + POST /auth/google code exchange

**Plan file:** `.ai-factory/plans/26-get-auth-google-initiator-post-auth-google-code-exchange.md`
**Risk Level:** 🔴 High — one critical architectural flaw in the redirect-URI design that will break the web OAuth flow at runtime.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)**: Modular monolith. The plan keeps `AuthService` injection inside `AuthModule` (where `GoogleCallbackController` already lives). `@InjectRepository` is not introduced into the controller — DB access goes through `AuthService`. ✅ aligned.
- **Rules (`.ai-factory/RULES.md`)**: Plan explicitly forbids `!`, forbids logging `dto.code`/`dto.redirectUri`, and tells the implementer to log outcomes only. ✅ aligned.
- **Roadmap (`.ai-factory/ROADMAP.md`)**: This milestone is the third unchecked item under the web-dashboard REST phase. Linkage is correct. ✅ aligned.

## Critical Issues

### 1. `WEB_REDIRECT_URI` value collides with the mobile deep-link relay — browser flow cannot complete (Task 1)

The plan instructs setting

```
WEB_REDIRECT_URI=https://dev.mind-awake.life/auth/google/callback   (.env)
WEB_REDIRECT_URI={APP_BASE_URL}/auth/google/callback                 (.env.dev, .env.prod)
```

i.e. the existing **mobile** deep-link callback path on the API host (the `#deeplink` comment next to `APP_BASE_URL` confirms `APP_BASE_URL` is the mobile universal-link / app-link host, not a web app host).

Trace what happens when a browser completes the new web flow with this `WEB_REDIRECT_URI`:

1. Browser hits `GET /auth/google` → 302 to Google with `redirect_uri=https://dev.mind-awake.life/auth/google/callback`.
2. Google redirects back to `https://dev.mind-awake.life/auth/google/callback?code=XYZ`.
3. That URL is **already routed** by the existing `googleCallback` handler in `src/users/controller/google-callback.controller.ts:11-31` (Task 1 in the plan says it "must remain untouched").
4. The existing handler ignores browser context, reads `code`, and replies `302 → https://dev.mind-awake.life/auth/google/callback?googleCode=XYZ` — designed so a mobile universal-link intercepts the response on-device.
5. In a browser (no universal link), the browser follows that 302 back to the API. The handler is now hit with `?googleCode=XYZ` (no `code=`/`error=` param), enters the `if (error || !code)` branch, logs `missing_code`, and 302s with `?googleError=missing_code` — and there is no way for the web app to ever observe `code`.

The web app therefore **cannot complete the flow**. POST `/auth/google` is never invoked because the browser never gets the code into a page that mind_web controls. There is also no mind_web route at `/auth/google/callback` (the path is server-routed by NestJS on the API host, which takes precedence over any SPA fallback even if hosted on the same domain).

The redirect URI for the browser flow must point at a URL that mind_web controls — e.g., a route in the React app at `https://<web-host>/auth/google/callback` whose page-load reads `?code=` from `window.location` and POSTs to `/auth/google`. Picking that host is genuinely an open design decision (mind_web is hosted independently of `APP_BASE_URL`). The note in `.ai-factory/notes/10-web-dashboard-rest-api-spec.md:62-64` that this plan inherited from is wrong on the same point; this plan propagates the flaw without surfacing it.

**Recommended resolution:** introduce a dedicated env var, e.g.

```
WEB_REDIRECT_URI=https://<mind_web host>/auth/google/callback
```

set per-env to the actual deployed web host (and `http://localhost:5173/auth/google/callback` in `.env` for `npm run dev`). Coordinate with mind_web to add a route that captures `?code=` and POSTs it to `/auth/google`. Register the chosen URI(s) in Google Cloud Console under the same OAuth client.

Until this is fixed, Tasks 1–5 build endpoints whose happy path cannot succeed end-to-end in a browser.

## Non-Critical Findings

### 2. `redirectUri` regex in the DTO is narrower than the existing mobile DTO — verify alignment with the chosen web host (Task 2)

Plan uses `@Matches(/^https?:\/\//)` for `redirectUri`. That is fine if the web host is always served over http/https (it will be). Just confirm it accepts `http://localhost:5173/...` (it does — the regex allows `http:`). No change required, but worth noting for the implementer that local dev must use `http://` not `https://`.

### 3. `URLSearchParams` produces `+` for space rather than `%20` for `scope=openid email profile` (Task 4)

`URLSearchParams` encodes spaces as `+`. Google accepts both `+` and `%20` in `scope`, so functionally fine, but be aware: existing internal docs and Google's own examples show `%20`. No action required; flagging only because the plan stresses correct percent-encoding as the rationale for `URLSearchParams`.

### 4. `@HttpCode(HttpStatus.OK)` choice for `POST /auth/google` (Task 5)

The plan returns `AuthResponseDto` with `HttpCode(200)`. This matches the sibling endpoint `POST /auth/verify-code` in `src/users/controller/auth.rest.controller.ts:18-22`. ✅ consistent.

### 5. CORS

The web flow's `POST /auth/google` must succeed cross-origin from the mind_web host. Global CORS is configured in `src/main.ts:87-91` with `origin: process.env.FRONTEND_URL || 'http://localhost:8000'`. If mind_web runs on `http://localhost:5173` for dev, `FRONTEND_URL` needs to be set per-env (or the default expanded to include 5173). Not strictly a defect in this plan — CORS configuration is shared infra — but the plan should at least mention the prerequisite so the implementer doesn't ship endpoints that 200 in curl but fail in the browser. Recommend adding a short Notes entry.

### 6. No catch around `signInWithGoogle` (Task 5) — acceptable but undocumented response shape

The plan correctly says "let `UnauthorizedException` from `GoogleTokenService` propagate". `GoogleTokenService.exchangeCodeForProfile` only throws `UnauthorizedException` (`src/users/service/google-token.service.ts:42, 50, 81`). However `AuthService.signInWithGoogle` runs `dataSource.transaction(...)` and `userRepository.save` which can throw `QueryFailedError` / `Error` on DB issues — those will surface as 500s, which is correct REST behavior. No fix needed, just confirming the design is sound.

### 7. Constructor wiring — confirmed safe (Task 3)

`AuthService` and `GoogleCallbackController` both live in `AuthModule` (`src/users/auth.module.ts:43-44, 14`). No circular dependency or new export needed. ✅

### 8. Route conflict check — confirmed safe (Tasks 4, 5)

`GET /auth/google` (new), `POST /auth/google` (new), `GET /auth/google/callback` (existing) are three distinct method+path combinations. Express/NestJS will not conflict. ✅

## Positive Notes

- Clear delegation to existing `AuthService.signInWithGoogle` rather than re-implementing user upsert / JWT issuance.
- Correctly identifies that `GoogleTokenService.exchangeCodeForProfile(code, redirectUri)` already supports the browser flow via `redirectUri` arg.
- Honors the modular monolith — no new `@InjectRepository` in the controller.
- Explicit rule callouts (no `!`, no sensitive logging) embedded in task instructions.
- Notes section correctly identifies that `AuthModule` needs no changes.
- DTO mirrors the shape of the existing `GoogleAuthDto` (language optional, code required, redirectUri required for browser flow), keeping the surface coherent.

## Required Changes Before Implementation

1. **Resolve Critical #1** — decide the actual web-app redirect URI (a URL mind_web controls, not the mobile deep-link path) and update Task 1's env-var values accordingly. Coordinate Google Cloud Console registration. Update mind_web with a matching route.
2. **Add a Notes bullet** about CORS (`FRONTEND_URL` / origin allow-list) so the implementer pre-checks that the new endpoint will be callable from the browser.

The remaining tasks (DTO shape, controller wiring, endpoint bodies) are sound — only the redirect-URI value and the missing CORS note need addressing.
