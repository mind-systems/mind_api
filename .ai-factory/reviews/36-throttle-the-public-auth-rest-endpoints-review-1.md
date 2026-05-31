# Code Review: Throttle the public auth REST endpoints

**Plan:** `.ai-factory/plans/36-throttle-the-public-auth-rest-endpoints.md`
**Reviewed:** `git diff HEAD` — code changes in `package.json`, `src/app.module.ts`, `src/users/controller/auth.rest.controller.ts` (+ docs/CLAUDE/ARCHITECTURE).
**Risk Level:** 🟢 Low

## Scope of change
- `package.json` — adds `@nestjs/throttler@^6.0.0`.
- `src/app.module.ts` — imports `ThrottlerModule`, registers `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])` in `imports`.
- `src/users/controller/auth.rest.controller.ts` — adds `@UseGuards(ThrottlerGuard)` at class level, `@Throttle({ default: { ttl: 60_000, limit: 3 } })` on `sendCode`, `@Throttle({ default: { ttl: 60_000, limit: 10 } })` on `verifyCode`.
- Docs (`docs/auth/rate-limiting.md`, `ARCHITECTURE.md`, `CLAUDE.md`) — descriptive only.

## Verified correct

- **Installed version matches the plan's pin.** `@nestjs/throttler@6.5.0` is resolved; its peer deps allow `@nestjs/common`/`@nestjs/core` `^11`, and the running stack is `@nestjs/common@11.1.13`. The array config form `forRoot([{ ttl, limit }])` and millisecond `ttl` (60_000 = 60s) are the correct v5/v6 API. ✓
- **No `APP_GUARD` / global guard.** Grep of `src/` shows no `APP_GUARD`, no `useGlobalFilters`, no `APP_FILTER`. The guard is applied only via `@UseGuards(ThrottlerGuard)` on `AuthRestController`, so gRPC and streaming routes stay unthrottled — the spec's central "Trap" is honored. ✓
- **DI resolves.** `ThrottlerModule.forRoot()` registers globally in v6, exposing `ThrottlerStorage` + options app-wide, so the controller-scoped `ThrottlerGuard` instantiates correctly without importing anything into `AuthModule`. ✓
- **Per-route override semantics.** Each route's `@Throttle({ default: {...} })` overrides the named `default` throttler from the global `forRoot`, so the 60/min global default never governs these two routes — it only serves as the fallback name. Both public routes in the controller (`send-code`, `verify-code`) carry an explicit `@Throttle`; no route is left on the loose global default. ✓
- **429 reaches the REST client cleanly.** `ThrottlerException` extends `HttpException` (429). The only `@Catch(HttpException)` filter, `src/grpc/grpc-exception.filter.ts`, is gRPC-scoped (not global), so it does not intercept the REST throttle response. The 401-vs-429 distinction for the verify path (documented in `rate-limiting.md`) is preserved. ✓
- **Controller bodies unchanged.** `sendCode`/`verifyCode` method bodies, `@Post`, and `@HttpCode(HttpStatus.OK)` are byte-for-byte identical to before — only decorators/imports added. ✓
- **Typecheck of changed files is clean.** `tsc --noEmit` reports no errors in `app.module.ts`, `auth.rest.controller.ts`, or anything throttler-related. (Pre-existing, unrelated `TS2352` errors exist only in `src/realtime/services/biometric-stream-engine.service.spec.ts` — not touched by this change.) ✓
- **Client-IP keying matches the revised plan.** No `trust proxy` is set in `main.ts` (confirmed unchanged), so the default tracker keys on `req.ip` (TCP peer) — correct for the directly-published prod port and not XFF-spoofable. ✓
- **Docs language consistent.** `docs/auth/rate-limiting.md` is written in Russian, matching the existing `docs/auth/email-auth.md` neighbors, and its content (5-miss lockout, 3/min·10/min, `req.ip` keying, in-memory per-process store) accurately reflects the code. ✓

## Non-blocking observations (no action required)

- **`package.json` ordering.** The new `@nestjs/throttler` line is inserted between `google-auth-library` and `helmet`, breaking the otherwise-alphabetical `dependencies` ordering. Purely cosmetic — no functional impact.
- **In-memory, per-process store.** Limits are not shared across replicas; durability is intentionally deferred to the Task-A DB lockout. Already acknowledged in the plan and docs — a conscious tradeoff, not a defect.
- **e2e awareness.** `test/app.e2e-spec.ts` boots the full `AppModule`; `ThrottlerModule.forRoot([...])` adds no required env and won't break bootstrap, but a future test hammering `/auth/*` could trip a 429. No action now (Settings: Testing = no).

## Verdict
The implementation matches the plan exactly, compiles, resolves DI, keeps gRPC/streaming unthrottled, and returns 429 correctly on the REST surface. No correctness, security, or runtime-breaking findings.

REVIEW_PASS
