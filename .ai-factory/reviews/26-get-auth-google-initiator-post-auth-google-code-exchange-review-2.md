# Code Review (iteration 2): GET /auth/google initiator + POST /auth/google code exchange

**Reviewed diff:** `src/users/controller/google-callback.controller.ts`, `src/users/dto/google-code-exchange.dto.ts`. Env-file changes (`.env`, `.env.dev`, `.env.prod`) unchanged since review-1.

**Risk Level:** 🟢 Low — review-1 finding #2 (redirectUri allow-list) is now resolved by a strict-equality check against `WEB_REDIRECT_URI` (`src/users/controller/google-callback.controller.ts:70-74`). Remaining items are either accepted-out-of-scope (CSRF `state`) or operational (placeholder hostnames).

---

## Resolved since review-1

- ✅ **Finding #2 (redirectUri allow-list)** — `exchangeGoogleCode` now reads `WEB_REDIRECT_URI` and throws `BadRequestException('Invalid redirectUri')` on mismatch before calling `signInWithGoogle`. The contract is now self-enforcing rather than relying on Google Cloud Console hygiene.

## Persisting items (carried from review-1, severity unchanged)

### 1. 🟡 `GET /auth/google` still issues no OAuth `state` parameter (security)

**File:** `src/users/controller/google-callback.controller.ts:50-63`

No CSRF/login-CSRF binding between the initiator and `POST /auth/google`. Mitigation should be a follow-up milestone — see review-1 §1 for the recommended fix shape (random nonce → `HttpOnly`/`SameSite=Lax` cookie → echoed back from `mind_web`). Out-of-scope for this milestone per the plan.

### 2. 🟢 `.env.dev` / `.env.prod` carry placeholder `# TODO:` hostnames (operational)

`.env.dev:31, 34` and `.env.prod:31, 34` still contain best-guess hostnames behind `# TODO: set to ... mind_web host` markers. Must be replaced with real hosts before deployment and registered in Google Cloud Console; otherwise `POST /auth/google` returns 401 (`redirect_uri_mismatch`) and the browser CORS preflight fails.

### 3. 🟢 `URLSearchParams` encodes `scope` space as `+` rather than `%20` (informational)

Already documented; no action.

### 4. 🟢 No logging in new handlers (informational)

Acceptable per `.ai-factory/RULES.md` and milestone "minimal logging" setting; `AuthService.signInWithGoogle` already logs the user-lookup/creation outcome.

---

## New observations from iteration 2

### 5. 🟢 Strict equality on `redirectUri` is intentional but trailing-slash-sensitive (informational)

**File:** `src/users/controller/google-callback.controller.ts:72`

`dto.redirectUri !== allowedRedirectUri` is exact-match, including case and trailing slash. If a future `mind_web` build serves the callback page at `…/callback/` (trailing slash) while the env value is `…/callback` (or vice versa), every request will 400. The strict comparison is the correct default — fail-closed — but worth a one-line comment or doc note so the next operator knows to keep the two strings byte-identical. No code change required for this milestone.

### 6. 🟢 `BadRequestException` short-circuits before token exchange (informational)

The allow-list check runs before `signInWithGoogle`, which is correct: it avoids burning a single-use OAuth code against Google's token endpoint when the request is structurally invalid. No issue.

### 7. 🟢 `dto.redirectUri` validated as http(s) URL but no length cap (informational)

`@Matches(/^https?:\/\//)` accepts arbitrarily long strings. `BadRequestException` will catch any value that doesn't equal `WEB_REDIRECT_URI`, so the practical attack surface is nil. Global `ValidationPipe` does not enforce a `@MaxLength`, but request size is bounded by Nest's default body parser (~100kB). Acceptable.

---

## Runtime-break checklist

- ✅ No new migrations.
- ✅ No proto changes.
- ✅ Type checks: `signInWithGoogle(string, string?, string?)` matches the call shape.
- ✅ No race conditions; underlying transaction in `signInWithGoogle` still uses pessimistic write lock on user lookup.
- ✅ No new modules to register.
- ⚠️ Operational dependencies unchanged: Google Cloud Console must list each env's `WEB_REDIRECT_URI`; real `mind_web` hostnames must replace TODOs.

---

## Verdict

Review-1's actionable finding (#2) is fixed. Remaining items are either accepted-out-of-scope (`state` parameter) or operational (real hostnames). The implementation is ready to ship for this milestone scope.

REVIEW_PASS
