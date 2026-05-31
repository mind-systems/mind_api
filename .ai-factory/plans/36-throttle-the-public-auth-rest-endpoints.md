# Plan: Throttle the public auth REST endpoints

## Context
Add IP-layer rate limiting to the public, unguarded auth REST routes (`POST /auth/send-code`, `POST /auth/verify-code`) using `@nestjs/throttler`, applied per-route on `AuthRestController` only so gRPC and streaming routes stay unthrottled. This is defense-in-depth on top of the task-A per-code DB lockout (already shipped — Phase 27 item 1).

Spec: `.ai-factory/notes/20-spec-otp-bruteforce-protection.md` §Task B.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Client-IP keying (do NOT set `trust proxy`)
The `ThrottlerGuard` default tracker keys on `req.ips[0] ?? req.ip`. The prod stack (`docker-compose.prod.yml`) publishes the API's HTTP port directly — there is **no nginx / reverse proxy** in front of it and nothing in the repo sets `X-Forwarded-For`. So:
- Leave Express `trust proxy` **unset** (its current state). `req.ip` resolves to the TCP peer = the real client, and throttling works per-client.
- Do **not** add `app.set('trust proxy', 1)`. With no proxy stripping/overwriting XFF, trusting it would let a brute-force attacker rotate `X-Forwarded-For: <random>` per request into a fresh bucket — defeating the very feature this plan ships.
- **Future caveat:** if a real XFF-setting reverse proxy is ever placed in front of prod, `trust proxy` must be set to that proxy's exact hop count *at the same time* (and only if the proxy overwrites, not appends, client-supplied XFF). Not in scope now.

## Tasks

### Phase 1: Dependency & module setup

- [x] **Task 1: Install `@nestjs/throttler` (pinned to v6) and register `ThrottlerModule`**
  Files: `package.json`, `src/app.module.ts`
  Run `npm install @nestjs/throttler@^6`. The explicit `^6` pin matters: the array config (`forRoot([...])`) and millisecond `ttl` syntax used below are v5/v6 form — v4 used object config and **seconds**, so an unpinned resolve that ever pulled v4 would silently turn `60_000` into ~16 minutes.
  In `AppModule`, import `ThrottlerModule` from `@nestjs/throttler` and add `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])` to the `imports` array (a sane global default; per-route `@Throttle` on the controller overrides it). `forRoot` registers the module globally in v5+, so the guard resolves app-wide without importing anything into `AuthModule`.
  Do **NOT** register `ThrottlerGuard` as `APP_GUARD` — global throttling must not be applied, because gRPC and streaming routes must stay unthrottled.
  Note: the default storage is in-memory and **per-process**, so limits are not shared across replicas — this is a conscious choice; durable, replica-wide protection is provided by the Task-A DB lockout.

### Phase 2: Per-route throttling on the controller

- [x] **Task 2: Apply `ThrottlerGuard` + per-route `@Throttle` on `AuthRestController`** (depends on Task 1)
  Files: `src/users/controller/auth.rest.controller.ts`
  Import `Throttle` and `ThrottlerGuard` from `@nestjs/throttler` and add `UseGuards` to the existing `@nestjs/common` import. Add `@UseGuards(ThrottlerGuard)` at the class level (scoped to this controller only — not global). Decorate `sendCode` with `@Throttle({ default: { ttl: 60_000, limit: 3 } })` (~3/min) and `verifyCode` with `@Throttle({ default: { ttl: 60_000, limit: 10 } })` (~10/min). Keep the existing `@Post`/`@HttpCode` decorators and method bodies byte-for-byte unchanged; only add the guard and throttle decorators. Exceeding a limit yields the throttler's default 429 response.

## Out of scope (intentional boundaries)
- No `trust proxy` change (see the Client-IP keying section above).
- The other public auth REST routes (`GET`/`POST /auth/google` in `GoogleCallbackController`) stay unthrottled — this milestone is scoped to OTP brute-force on `AuthRestController` only.
- The Task-A per-code DB lockout is already shipped (Phase 27 item 1 / plan 35); not revisited here.
