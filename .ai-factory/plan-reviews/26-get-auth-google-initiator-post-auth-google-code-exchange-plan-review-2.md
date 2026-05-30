# Plan Review 2: GET /auth/google initiator + POST /auth/google code exchange

**Plan file:** `.ai-factory/plans/26-get-auth-google-initiator-post-auth-google-code-exchange.md`
**Files Reviewed:** 1 plan file + plan-review-1 + targeted code/env audit
**Risk Level:** 🟢 Low — plan-review-1's blocking issue is resolved with a thorough architectural justification. Remaining items are non-blocking notes.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)**: Modular monolith preserved. No new `@InjectRepository` in `GoogleCallbackController`; DB writes still flow through `AuthService` (which already owns `User` repo and `dataSource.transaction(...)`). ✅ aligned.
- **Rules (`.ai-factory/RULES.md`)**: Plan explicitly forbids `!`, forbids logging `dto.code` / `dto.redirectUri`, and tells implementer to log outcomes only. Logging guidance is consistent with the existing `googleCallback` style. ✅ aligned.
- **Roadmap (`.ai-factory/ROADMAP.md`)**: Milestone is the unchecked web-dashboard REST item at line 83. Note: the roadmap line itself still says `WEB_REDIRECT_URI={APP_BASE_URL}/auth/google/callback` — the plan correctly overrides this stale value with the mind_web host (the same fix plan-review-1 demanded). Implementer should not be confused by the roadmap text. ⚠ WARN — recommend updating the roadmap line in a follow-up when the milestone is closed, but does not block this plan.

## Resolution of plan-review-1 findings

- **Critical #1 (WEB_REDIRECT_URI pointed at the mobile deep-link relay)** — ✅ Resolved. Plan §"Architectural note" walks through the exact failure mode plan-review-1 described and pins the redirect URI to a `mind_web`-controlled URL. Task 1 spells out per-env values (`http://localhost:5173/auth/google/callback` for `.env`, deployed mind_web hosts for dev/prod) and surfaces the Google Cloud Console + mind_web route prerequisites to the user instead of silently assuming them. The implementer is told to use a TODO-comment placeholder if the deployed host is not yet known, which keeps the file functional without inventing a wrong host.
- **CORS note (Non-Critical #5)** — ✅ Resolved. A dedicated Notes bullet documents the `FRONTEND_URL` default-vs-allow-list trade-off and explicitly out-of-scopes the allow-list rewrite.
- All other plan-review-1 ✅ items (DTO shape, route conflict, controller wiring, no AuthModule changes, `@HttpCode(200)` parity, exception propagation) are carried forward unchanged.

## Independent verification against the codebase

- `GoogleCallbackController` (`src/users/controller/google-callback.controller.ts:1-32`) — confirmed to be the same controller, currently injecting only `ConfigService`. Adding `AuthService` to the constructor is the right move.
- `AuthService.signInWithGoogle(serverAuthCode, language?, redirectUri?)` (`src/users/service/auth.service.ts:51-96`) — signature matches the plan's call `this.authService.signInWithGoogle(dto.code, dto.language, dto.redirectUri)`.
- `GoogleTokenService.exchangeCodeForProfile(code, redirectUri?)` (`src/users/service/google-token.service.ts:20-86`) — already branches on `isBrowserFlow = !!redirectUri` and only `throw`s `UnauthorizedException`. Letting that propagate yields 401 — matches plan intent and `POST /auth/verify-code` behavior.
- `AuthModule` (`src/users/auth.module.ts:43-44`) — `GoogleCallbackController` declared in `controllers`, `AuthService` declared in `providers`. No module surgery needed, as the plan claims.
- `AuthRestController.verifyCode` (`src/users/controller/auth.rest.controller.ts:18-22`) — uses `@HttpCode(HttpStatus.OK)` + `@Body() dto` returning `AuthResponseDto`. Plan's `POST /auth/google` mirrors this exactly. ✅
- `AuthGrpcController.googleAuth` (`src/users/auth.grpc.controller.ts:65-72`) — confirmed delegation pattern matches what the plan inherits.
- `GoogleAuthDto` (`src/users/dto/google-auth.dto.ts`) — uses a broader scheme regex (`^[a-z][a-z0-9+\-.]*:\/\/`) because the mobile flow accepts custom URI schemes; the plan tightens to `^https?:\/\/` for the web flow only. Intentional and correct — no parity issue.
- `main.ts` (`src/main.ts:87-91`) — CORS is `origin: process.env.FRONTEND_URL || 'http://localhost:8000'` (single-origin string). Plan's CORS note accurately describes this.

## Critical Issues

None.

## Non-Critical Findings

### 1. `FRONTEND_URL` is currently absent from every env file — CORS will reject the browser flow in local dev unless the implementer also updates env files

Audit of `.env`, `.env.dev`, `.env.prod`: `FRONTEND_URL` is not set anywhere, so CORS resolves to the `http://localhost:8000` default. With `WEB_REDIRECT_URI=http://localhost:5173/...` and the web app running on Vite's `:5173`, the browser will block `POST /auth/google` cross-origin.

The plan flags this in Notes ("Before the implementer ships, confirm `FRONTEND_URL` is set per env to the same host registered in `WEB_REDIRECT_URI`") but doesn't turn it into a task. Whether this is in scope depends on how strict the milestone boundary is — a single-host `FRONTEND_URL` value change is the same shape of edit as `WEB_REDIRECT_URI` (one line per env file, no `main.ts` change), so it would be cleaner to either:

- **Option A (recommended):** add a Task 6 "Add `FRONTEND_URL=<same host as WEB_REDIRECT_URI>` to `.env`, `.env.dev`, `.env.prod`" — symmetric with Task 1, keeps the milestone's happy path actually executable in dev.
- **Option B:** keep as-is and live with the implementer setting the env var out-of-band per the Notes bullet.

Not blocking — Option B is defensible given the plan's explicit out-of-scoping of allow-list work. Flagging because "happy path cannot succeed end-to-end" was exactly the concern that elevated plan-review-1's earlier finding to Critical; here the impact is narrower (CORS-block in browser only, not a routing dead-end) and the fix is one-line per env, so it's a Non-Critical nudge.

### 2. Roadmap line at `ROADMAP.md:83` still carries the stale `WEB_REDIRECT_URI={APP_BASE_URL}/auth/google/callback` instruction

This is the same flaw plan-review-1 identified and this plan correctly diverges from. The plan's `Architectural note` is the right place to document the divergence, but the roadmap text is now inconsistent with the plan it spawned. Recommend updating the roadmap line (or noting the divergence) when this milestone is closed so the next reader doesn't re-introduce the bug. Not blocking the implementation.

### 3. `.env.dev` / `.env.prod` placeholder hosts depend on a `mind_web` deployment decision

Task 1 instructs the implementer to put an example host (`https://web.dev.mind-awake.life/...`) plus a `TODO` comment if the actual deployed host is unknown. This is the right escape hatch and matches what plan-review-1 explicitly called for ("Picking that host is genuinely an open design decision"). Just confirming: the implementer is told to *surface* the unresolved hosts to the user rather than silently choose. Acceptable.

### 4. `redirectUri` in `GoogleCodeExchangeDto` is server-trusted only as far as Google enforces it

The DTO's `redirectUri` flows into `GoogleTokenService.exchangeCodeForProfile` → `OAuth2Client.getToken({code, redirect_uri})`. Google rejects any value that doesn't match what the original authorization request used. So a malicious caller sending an arbitrary `redirectUri` cannot make the exchange succeed against a code minted for a different URI — Google's `redirect_uri_mismatch` protection covers this. No host-allowlist needed at the DTO level. Confirming this is safe rather than flagging it as an action item.

### 5. `URLSearchParams` `+`-vs-`%20` encoding for `scope`

Plan-review-1 noted this already and the new plan carries the rationale forward in Task 4. No action.

## Positive Notes

- The `Architectural note` block at the top of the plan explains *why* the redirect URI differs from `APP_BASE_URL` in terms a future reader (or roadmap pruner) can use to avoid the same trap. This is the right way to document a non-obvious design constraint.
- Out-of-band prerequisites (Google Cloud Console registration, mind_web route coordination) are surfaced inside Task 1 *and* repeated in Notes, so they cannot be missed.
- Per-env values for `.env`, `.env.dev`, `.env.prod` are concrete; the TODO-comment fallback for unknown hosts is a clean escape hatch.
- Delegation chain `controller → AuthService.signInWithGoogle → GoogleTokenService.exchangeCodeForProfile` mirrors the existing gRPC path exactly — no duplicated logic.
- DTO `@Matches(/^https?:\/\//)` is correctly justified (local dev needs `http://`).
- Explicit rule callouts (no `!`, no logging of `code`/`redirectUri`) embedded in task instructions.
- CORS prerequisite documented with the right scope-limiting language ("widening to an allow-list is out of scope").

## Required Changes Before Implementation

None blocking. Optional improvement: add a Task 6 to set `FRONTEND_URL` per env file (Non-Critical #1, Option A) so the local-dev browser flow doesn't 0-byte on CORS.

PLAN_REVIEW_PASS
