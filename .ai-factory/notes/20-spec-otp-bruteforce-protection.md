# Spec — Phase 27: brute-force protection for OTP verify

**Date:** 2026-05-31
**Source:** code review note 15 §LOW + research note 16
**Targets:** `src/users/entities/auth-code.entity.ts`, `src/users/service/auth-code.service.ts`, `src/users/service/auth-code.service.spec.ts`, `src/users/controller/auth.rest.controller.ts`, `AppModule`
**Scope:** task A adds a migration; task B adds a dependency.

## Problem
`verifyCode` accepts a 6-digit code (900k space, `generateCode` via `crypto.randomInt`), single-active per email, 15-min expiry, but has **no failed-attempt lockout and no HTTP throttle**; the REST endpoints are public/unguarded. An attacker who knows a victim's email can brute-force the active code well within the expiry window. `sendCode` already has a 60s per-email cooldown (good); the gap is on verify.

---

## Task A — per-email failed-attempt lockout on `AuthCode`

### Entity + migration
Add to `auth-code.entity.ts`:
- `@Column({ type: 'smallint', default: 0 }) failedAttempts: number`
- `@Column({ type: 'timestamptz', nullable: true }) lockedUntil: Date | null`

Generate `npx typeorm migration:create src/migrations/AddAuthCodeAttemptTracking` — add both columns to `auth_codes` (default 0 / NULL, additive & back-fill-safe); `down` drops them. Runs on startup (`migrationsRun: true`).

### Rework `verifyCode`
Today it queries by `codeHash AND email` together, so a wrong code matches no row and can't be counted. Change to:
1. Load the active code row by **email** (`used = false AND expiresAt > now`, newest first, `pessimistic_write` lock — keep the lock so concurrent verifies serialize and increments stay correct). None → `UnauthorizedException('Invalid or expired code')` as today.
2. If `lockedUntil` set and in the future → throw a **429-mapped** exception: `new HttpException('Too many attempts, request a new code', HttpStatus.TOO_MANY_REQUESTS)` — NOT a 401 (see cross-client note).
3. Compare `hashCode(code)` to `row.codeHash`:
   - mismatch → increment `failedAttempts`; once it reaches **5**, set `lockedUntil = now + 15min`; `save`; throw `UnauthorizedException('Invalid or expired code')`.
   - match → proceed exactly as today (mark `used`, find/create user, issue JWT). Happy path byte-for-byte identical.

### Per-code, not per-email-persistent
The counter lives on the `AuthCode` row. `sendCode` already does `delete({ email })` + insert a fresh row (`failedAttempts = 0`), so a new code resets the counter. Intended: primary control = per-code lockout (5 tries) + the existing 60s send cooldown. **Do not carry the counter across codes.**

### Cross-client (shared by gRPC + REST)
`verifyCode` is called by both `AuthRestController` and gRPC `auth.grpc.controller.ts:56` (mobile). `GrpcExceptionFilter` maps 401→`UNAUTHENTICATED` and 429→`RESOURCE_EXHAUSTED`, so throwing the lock as 429 lets mobile distinguish "locked" from "wrong code" by status, not message text. Mobile handling: `mind_mobile/.ai-factory/notes/45-otp-verify-lockout-requirements.md`.

### Rewrite the spec tests
`auth-code.service.spec.ts` (~lines 214-307) mocks the query builder on `ac.codeHash = :codeHash` and returns one fixed `AuthCode` for any input. After switching to load-by-email + in-code hash compare, the happy-path mock `makeAuthCode` must return `codeHash = hashCode('123456')` (the expected code) or every success case fails the compare. Add cases for the 5-miss lock and the `lockedUntil`-in-future short-circuit.

---

## Task B — throttle the public auth REST endpoints

Add `@nestjs/throttler` (`npm install @nestjs/throttler`); register `ThrottlerModule.forRoot([{ ttl: 60_000, limit: <global> }])` in `AppModule`.

**Trap:** do **NOT** register `ThrottlerGuard` globally (no `APP_GUARD`) — gRPC and streaming routes must stay unthrottled. Instead apply `@UseGuards(ThrottlerGuard)` + per-route `@Throttle` on `AuthRestController` only: `send-code` ~3/min, `verify-code` ~10/min.

IP-layer defense-in-depth on top of the task-A lockout (which is the primary, restart-/replica-durable control). Note the throttler's default in-memory store is per-instance; a multi-replica deployment that needs shared limits requires a shared store (the DB lockout already covers durability).
