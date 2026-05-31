# Plan: Per-email failed-attempt lockout on `AuthCode`

## Context
Add a per-code failed-attempt lockout to the OTP verify flow so a known-email code can no longer be brute-forced within the 15-min window: track misses on the `AuthCode` row and lock the code for 15 minutes after 5 wrong tries, surfaced as a 429 shared by both REST and gRPC clients.

## Settings
- Testing: yes (spec rewrite is part of the milestone)
- Logging: minimal
- Docs: no

## Critical design constraint (read before Task 3)
`verifyCode` wraps its work in `this.dataSource.transaction(async (manager) => { … })`. TypeORM commits that transaction only when the callback **returns**, and **rolls it back when the callback throws**. So the failed-attempt increment and the `lockedUntil` write must NOT be followed by a `throw` out of the same callback — that rollback would discard the write and the lockout would never engage.

The fix: the transaction callback persists the counter/lock and **returns a discriminated result** describing the outcome; the caller (`verifyCode`) then throws the 401/429 **after** the transaction has committed. This keeps the `pessimistic_write` lock guarding the increment while ensuring the write survives.

## Tasks

### Phase 1: Schema

- [x] **Task 1: Add lockout columns to `AuthCode` entity**
  Files: `src/users/entities/auth-code.entity.ts`
  Add two columns to the entity:
  - `@Column({ type: 'smallint', default: 0 }) failedAttempts: number;`
  - `@Column({ type: 'timestamp', nullable: true }) lockedUntil: Date | null;`
  Use `type: 'timestamp'` (without time zone) to match the table's existing temporal columns — `expiresAt` is declared `type: 'timestamp'` and both `createdAt`/`expiresAt` are `TIMESTAMP` in `InitialSchema`. `Date` comparisons work identically either way; matching avoids mixing `timestamp`/`timestamptz` in one table. Additive only — do not touch existing columns/indexes. `lockedUntil` is nullable with no default; `failedAttempts` defaults to 0 so existing rows back-fill safely.

- [x] **Task 2: Generate and fill the migration** (depends on Task 1)
  Files: `src/migrations/<timestamp>-AddAuthCodeAttemptTracking.ts`
  Scaffold via CLI — never hand-craft the timestamp:
  ```bash
  npx typeorm migration:create src/migrations/AddAuthCodeAttemptTracking
  ```
  Implement `up` to `ALTER TABLE "auth_codes"` adding `"failedAttempts" smallint NOT NULL DEFAULT 0` and `"lockedUntil" TIMESTAMP NULL` (additive, back-fill-safe; note the DB uses quoted camelCase identifiers — no snake naming strategy). Use `TIMESTAMP` (without time zone) to match the entity decorator and the existing table columns. Implement `down` to drop both columns. Follow the raw-SQL `queryRunner.query(...)` style used by the existing migrations in `src/migrations/`. Migration runs automatically on startup (`migrationsRun: true`); also runnable manually with `npm run migration:run`.

### Phase 2: Logic

- [x] **Task 3: Rework `verifyCode` to load-by-email + count misses + lock, committing before throwing** (depends on Task 2)
  Files: `src/users/service/auth-code.service.ts`
  Replace the current `codeHash AND email` query with an email-only load and an in-code hash compare. Restructure so the transaction **returns** an outcome and the throw happens **outside** the transaction (see "Critical design constraint" above).

  Add private static consts alongside the existing ones: `MAX_FAILED_ATTEMPTS = 5`, `LOCK_MINUTES = 15` (reuse `CODE_EXPIRY_MINUTES` style — no magic numbers).

  Inside `this.dataSource.transaction(async (manager) => { … })`, keeping the `pessimistic_write` lock:
  1. Load the active code row by **email only**: `createQueryBuilder('ac').setLock('pessimistic_write').where('ac.email = :email', { email: normalizedEmail }).andWhere('ac.used = false').andWhere('ac.expiresAt > :now', { now: new Date() }).orderBy('ac.createdAt', 'DESC').getOne()`. If none → `return { outcome: 'invalid' as const }` (do NOT throw here).
  2. If `authCode.lockedUntil` is set and in the future → `return { outcome: 'locked' as const }`.
  3. Compute `this.hashCode(code)` and compare to `authCode.codeHash`:
     - **mismatch** → `authCode.failedAttempts += 1`; if `authCode.failedAttempts >= MAX_FAILED_ATTEMPTS` set `authCode.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000)`; `await manager.save(authCode)`; then `return { outcome: 'invalid' as const }`. The `save` commits because the callback returns rather than throws.
     - **match** → proceed exactly as today: set `used = true`, `manager.save`, find/create user, build the token via `authService.generateToken(user)`, and `return { outcome: 'ok' as const, auth: <AuthResponseDto> }`.

  After the transaction resolves, branch on the returned outcome:
  - `'invalid'` → `throw new UnauthorizedException('Invalid or expired code')` (same message for null-row and mismatch — avoids leaking whether an active code exists).
  - `'locked'` → `throw new HttpException('Too many attempts, request a new code', HttpStatus.TOO_MANY_REQUESTS)` (429, NOT 401). `HttpException`/`HttpStatus` are already imported.
  - `'ok'` → return `result.auth`.

  The happy-path observable behavior (mark used, find/create user, issue JWT) stays identical; only the throw site moves outside the transaction. Do not carry the counter across codes — `sendCode` already deletes + reinserts a fresh row (`failedAttempts = 0`) per send, the intended reset. Keep logging lean and PII-free (codeId/outcome only; never email or code) per project rules.

  Note (out of scope, do not change): once `verifyCode` loads by email, `IDX_auth_codes_code_hash` is no longer used by any query and becomes pure write overhead. Leave it for a future cleanup — flagged here so it isn't silently orphaned.

### Phase 3: Tests

- [x] **Task 4: Rewrite the `verifyCode` spec tests to assert the post-commit contract** (depends on Task 3)
  Files: `src/users/service/auth-code.service.spec.ts`
  The `verifyCode` block (~lines 216-312) relies on the query matching `ac.codeHash` and returns a fixed row for any input. After the load-by-email + in-code compare + return-then-throw change, rewrite as follows. **Assert on the observable thrown outcome (401/429) and the returned token — not merely "save was called,"** because the inline `dataSource.transaction` mock just invokes the callback and does NOT model rollback-on-throw, so a "save was called" assertion could pass on rolled-back code. (With the return-then-throw restructure the writes now happen on the return path, so they are genuinely reached — but still prefer asserting the thrown 401/429 as the contract.)

  - Add a spec helper for the real hash: `const hashOf = (c: string) => crypto.createHash('sha256').update(c).digest('hex');` (import `crypto`). Do not hard-code digest strings.
  - Happy-path rows must carry a matching hash: `makeAuthCode({ codeHash: hashOf('123456') })`. Apply to: "marks the code as used and returns a token", "creates a new user", "uses the part before @ as name", "does not create a user if one already exists".
  - Update the shared `makeQb` to include `orderBy: jest.fn().mockReturnThis()` (the reworked query adds `.orderBy('ac.createdAt', 'DESC')`).
  - Keep "invalid or expired code" (null row → `UnauthorizedException`).
  - Keep "normalizes email to lowercase": its **own inline qb object** must also gain `orderBy: jest.fn().mockReturnThis()` (else `.orderBy(...)` is `undefined` → `TypeError`), and update its `andWhere` assertion to the new email-only predicate `('ac.email = :email', { email: 'test@example.com' })`.
  - Add: **hash mismatch** — loaded row `makeAuthCode({ codeHash: hashOf('999999'), failedAttempts: 0 })`, call with `'123456'` → expects `UnauthorizedException`. May additionally assert `manager.save` was called with `failedAttempts: 1`, but the primary assertion is the thrown 401.
  - Add: **5th miss locks** — loaded row `makeAuthCode({ codeHash: hashOf('999999'), failedAttempts: 4 })`, call with wrong code → expects `UnauthorizedException`, and `manager.save` called with `failedAttempts: 5` and a `lockedUntil` Date in the future.
  - Add: **locked short-circuit** — loaded row `makeAuthCode({ lockedUntil: new Date(Date.now() + 60_000) })` → expects `HttpException` with status `HttpStatus.TOO_MANY_REQUESTS`; assert no token issued (`authService.generateToken` not called) and the row is not marked used.
  - Run `npx jest src/users/service/auth-code.service.spec.ts` to confirm green.
