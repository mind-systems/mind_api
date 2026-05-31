# Plan Review: Throttle the public auth REST endpoints

**Plan:** `.ai-factory/plans/36-throttle-the-public-auth-rest-endpoints.md`
**Reviewed against:** live codebase + `.ai-factory/notes/20-spec-otp-bruteforce-protection.md` §Task B + ROADMAP Phase 27
**Risk Level:** 🟡 Medium

## Summary

The plan is small (two tasks) and largely correct. File paths, controller/method names, module wiring, and the `@nestjs/throttler` API form all match the actual codebase and the source spec note. There is **one substantive security/correctness gap** — client-IP derivation behind the reverse proxy — that is unaddressed in both the plan and the spec, plus a few smaller notes worth folding in before implementation.

## Verified correct (no action needed)

- **Target controller path & symbols.** `src/users/controller/auth.rest.controller.ts` exists, exports `AuthRestController`, with methods `sendCode` (`@Post('send-code')`) and `verifyCode` (`@Post('verify-code')`). Task 2's path and method names are exact. ✓
- **`AppModule` path.** `src/app.module.ts` is correct; the `imports` array is the right insertion point. ✓
- **Throttler API form matches NestJS 11.** `@nestjs/throttler` is not yet a dependency (will be installed fresh → latest 6.x, peer-compatible with `@nestjs/common ^11`). The array config `forRoot([{ ttl: 60_000, limit }])` and `@Throttle({ default: { ttl, limit } })` are the v5/v6 syntax, and `ttl` in **milliseconds** (60_000 = 60s) is correct for v5+. ✓
- **No `APP_GUARD` — correct and important.** Scoping with `@UseGuards(ThrottlerGuard)` on the controller only keeps gRPC + streaming routes unthrottled, exactly as the spec's "Trap" demands. `ThrottlerModule.forRoot()` registers as a global module in v5+, so the guard resolves app-wide without importing anything into `AuthModule`. ✓
- **Limits match the spec.** send-code 3/min, verify-code 10/min, global default 60/min — consistent with note 20 §Task B. ✓
- **Scope is correct.** Task A (per-email DB lockout) is a separate, already-completed milestone (Phase 27 item 1 / plan 35); this plan correctly covers §Task B only. ✓

## Critical Issues

None that block compilation or DI.

## Should Address (Medium)

### 1. Client-IP source behind the reverse proxy is undefined → throttle is misconfigured in production
Neither the plan nor the spec addresses how `ThrottlerGuard` derives the client IP. The guard's default tracker uses `req.ips[0] ?? req.ip`. Express `trust proxy` is **not** set anywhere in `src/main.ts` (confirmed — no `app.set('trust proxy', …)`), so `req.ips` is empty and `req.ip` resolves to the **immediate peer** — i.e. the nginx/Docker reverse proxy used in prod (`make up-prod`), not the real client.

Consequences in the actual deployment:
- All clients collapse into a **single IP bucket**. send-code 3/min then becomes 3 requests/min *across all users combined* — the 4th legitimate user in any minute gets a 429. This is a self-inflicted DoS on a login flow.
- The per-IP brute-force defense the feature is meant to provide does not actually key on the attacker's IP.

Recommendation: add a task to either (a) set `app.set('trust proxy', 1)` in `main.ts` — note `NestFactory.create<NestExpressApplication>(AppModule, …)` (from `@nestjs/platform-express`) is needed for `.set()` to be typed, or use `app.getHttpAdapter().getInstance().set('trust proxy', 1)` — matched to the real proxy hop count, **or** (b) explicitly document that throttling is keyed per-proxy and is acceptable because the Task-A DB lockout is the primary control. Option (a) is preferred since this is a security control. In local/dev (no proxy) the current plan works; the gap only bites in prod, which makes it easy to miss.

### 2. Pin / confirm the throttler major version
`npm install @nestjs/throttler` resolves to the latest (6.x), which is what the array config + ms `ttl` syntax requires. If a lockfile or registry pin ever pulls v4, the same code silently mis-behaves (v4 used object config and **seconds** for `ttl`, so `60_000` would mean ~16 minutes). Recommend installing explicitly as `@nestjs/throttler@^6` so the syntax in Task 1/2 is guaranteed valid.

## Minor / Nice-to-have

- **Settings say "Testing: no", which is reasonable here**, but note the e2e harness (`test/app.e2e-spec.ts`) bootstraps the full `AppModule`. Adding `ThrottlerModule.forRoot([...])` introduces no new required env and will not break bootstrap; just be aware that any future e2e test hammering `/auth/*` could trip the 429. No action needed now.
- **In-memory, per-instance store.** The default storage is per-process, so limits are not shared across replicas. The spec already acknowledges this and defers to the DB lockout for durability — fine to leave as-is, but worth a one-line note in the implementation so it is a conscious decision rather than an oversight.
- **Out-of-scope but adjacent:** the other public auth REST routes (`GET`/`POST /auth/google` in `GoogleCallbackController`) remain unthrottled. The ROADMAP/spec deliberately scope this milestone to `AuthRestController` only (OTP brute-force), so this is acceptable — flagging only so it is a known, intentional boundary rather than a missed surface.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** WARN — no boundary violation. The plan adds a global cross-cutting concern (`ThrottlerModule` in `AppModule`, guard scoped to one controller); this fits the Modular Monolith pattern. ARCHITECTURE.md has no throttling/proxy section — consider a one-line note there if `trust proxy` is added, since IP handling becomes an app-wide bootstrap concern.
- **Rules (`.ai-factory/RULES.md`):** PASS — no rule touched. Plan adds no `!` assertions, no logging of PII (Settings: minimal logging), and the routes are REST (the `@Payload()`/`@GrpcCurrentUser()` rule is gRPC-only).
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS — the plan maps exactly to the open item under Phase 27 ("Throttle the public auth REST endpoints"), and faithfully implements its referenced spec note §Task B.

## Positive Notes

- Correctly avoids the `APP_GUARD` trap that would have throttled gRPC/streaming — the single biggest landmine here, called out explicitly.
- Per-route limits, controller-scoped guard, and config form all line up with the source spec and the installed NestJS 11 stack.
- Tight, well-bounded plan with no scope creep into the (already-shipped) Task-A lockout work.

## Verdict

Solid and implementable, but the client-IP-behind-proxy gap (finding #1) means the security control will not behave as intended in production and can degrade the login UX. Address #1 (and ideally #2) before implementation.
