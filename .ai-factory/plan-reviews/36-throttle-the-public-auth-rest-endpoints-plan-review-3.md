# Plan Review 3: Throttle the public auth REST endpoints

**Plan:** `.ai-factory/plans/36-throttle-the-public-auth-rest-endpoints.md`
**Reviewed against:** live codebase + `.ai-factory/notes/20-spec-otp-bruteforce-protection.md` §Task B + prior reviews (`-plan-review-1.md`, `-plan-review-2.md`)
**Risk Level:** 🟢 Low

## Summary

The plan now resolves both substantive findings from the prior reviews. The `trust proxy` task that review 2 correctly flagged as dangerous (it would have opened an `X-Forwarded-For` spoofing bypass, since there is no XFF-stripping proxy in front of prod) has been **removed**, and replaced with a clear "Client-IP keying (do NOT set `trust proxy`)" rationale section that documents the decision and the future caveat. The remaining two tasks (install + module wiring, controller-scoped guard + per-route `@Throttle`) are byte-accurate against the live controller and module, use the correct `@nestjs/throttler` v6 API form, and avoid the `APP_GUARD` trap. An implementer can follow this verbatim.

## Verified correct against the codebase

- **`trust proxy` is currently unset.** `src/main.ts` calls `NestFactory.create(AppModule, …)` (no `NestExpressApplication` generic) and never calls `app.set('trust proxy', …)`. The plan's premise that `req.ip` resolves to the TCP peer is accurate at the Express layer. ✓
- **No reverse proxy in prod.** `docker-compose.prod.yml` contains exactly two services — `mind_database_prod_host` (postgres) and `mind_api_prod` — with the API HTTP port published directly (`${API_PORT_HOST}:${API_PORT_CONTAINER}`). No nginx / `proxy_pass` / XFF anywhere in the repo. The plan's "no nginx / reverse proxy" claim is correct, and dropping the `trust proxy` task is the right call. ✓
- **Task 1 — module wiring.** `src/app.module.ts` (47 lines) has a clean `imports` array (lines 20–44) — correct insertion point. `@nestjs/common`/`@nestjs/core` are `^11`, so `@nestjs/throttler@^6` is the right major. The `forRoot([{ ttl: 60_000, limit: 60 }])` array form + ms `ttl` are valid v5/v6 syntax, and the `@^6` pin guards against the v4 seconds-vs-ms footgun. ✓
- **No `APP_GUARD`.** The guard stays controller-scoped via `@UseGuards`, so gRPC + streaming routes remain unthrottled — the spec's central "Trap". `ThrottlerModule.forRoot()` registers globally in v5+, so the guard's deps (reflector / options / storage) resolve app-wide without importing anything into `AuthModule`. ✓
- **Task 2 — controller path & symbols.** `src/users/controller/auth.rest.controller.ts` exports `AuthRestController` with `sendCode` (`@Post('send-code')` + `@HttpCode(HttpStatus.OK)`) and `verifyCode` (`@Post('verify-code')` + `@HttpCode`). The existing `@nestjs/common` import is `{ Body, Controller, HttpCode, HttpStatus, Post }` — needs `UseGuards` added, exactly as the plan states. `@Throttle({ default: { … } })` correctly targets the unnamed (`'default'`) throttler from Task 1's `forRoot`. Limits (3/min, 10/min) and the 60/min global default match note 20 §Task B. ✓
- **Scope.** Task-A per-email DB lockout (plan 35) treated as already shipped and out of scope; `GoogleCallbackController` correctly left unthrottled — an intentional, documented boundary. ✓

## Critical Issues

None. Nothing blocks compilation or DI; both prior reviews' substantive findings are resolved.

## Minor / Nice-to-have (non-blocking)

- **Docker source-IP nuance.** The plan states `req.ip` "resolves to the TCP peer = the real client, and throttling works per-client." On the typical Linux Docker path (published ports via iptables DNAT) the container does see the real client IP, so this generally holds. The residual edge is Docker's userland `docker-proxy` (`userland-proxy: true`, the default), which in some setups can present the bridge gateway as the source — collapsing external clients into one bucket and turning `3/min` into a global limit. This is environment-dependent and does **not** block the feature: the per-email DB lockout (Task A) is the durable, per-identity control, and this throttle is explicit defense-in-depth. Worth a one-line acknowledgement in the plan that per-client keying assumes the container observes real client IPs, but no change required.
- **In-memory, per-process store.** Already acknowledged in Task 1's note; limits aren't shared across replicas, durability deferred to the DB lockout. Accurate, conscious tradeoff. No action.
- **e2e bootstrap.** `test/app.e2e-spec.ts` boots the full `AppModule`; adding `ThrottlerModule.forRoot([…])` introduces no new required env and won't break bootstrap. A future test hammering `/auth/*` could trip a 429 — awareness only (Settings: Testing = no).

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** WARN — no boundary violation. `ThrottlerModule` in `AppModule` + a controller-scoped guard fits the Modular Monolith pattern (cross-cutting concern registered globally, applied narrowly). No new module coupling. Nothing required.
- **Rules (`.ai-factory/RULES.md`):** PASS — no rule touched. No `!` non-null assertions, no PII logging (Settings: minimal logging), and these are REST routes (the gRPC `@Payload()`/`@GrpcCurrentUser()` rule does not apply).
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS — maps to the Phase 27 "Throttle the public auth REST endpoints" item and faithfully implements note 20 §Task B.

## Positive Notes

- Correctly removed the `trust proxy` task from review 2 instead of patching it — and documented *why* (no XFF-stripping proxy in prod → trusting XFF would let an attacker rotate `X-Forwarded-For` into fresh buckets and bypass the throttle). The rationale section is accurate and future-proofed with the reverse-proxy caveat.
- Avoids the `APP_GUARD` trap that would throttle gRPC/streaming — the single biggest landmine, handled explicitly.
- Tasks 1 and 2 are byte-accurate against the live controller and module; version pin and config form line up with the installed NestJS 11 stack.

## Verdict

The plan is solid and ready to implement. Both prior reviews' findings (version pin in review 1, the `trust proxy` XFF-bypass in review 2) are fully resolved, and every file path, symbol, and API form checks out against the live codebase. The only remaining item is a non-blocking awareness note about Docker source-IP observation, which the existing defense-in-depth framing already covers.

PLAN_REVIEW_PASS
