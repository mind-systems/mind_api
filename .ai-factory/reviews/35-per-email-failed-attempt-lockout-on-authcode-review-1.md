# Code Review: Per-email failed-attempt lockout on `AuthCode`

**Reviewed files (in full):**
- `src/users/entities/auth-code.entity.ts`
- `src/migrations/1780245770180-AddAuthCodeAttemptTracking.ts`
- `src/users/service/auth-code.service.ts`
- `src/users/service/auth-code.service.spec.ts`
- Cross-checked: `src/config/typeorm.config.ts`, `database.config.ts` (migration glob discovery)

**Verification performed:**
- `npx jest src/users/service/auth-code.service.spec.ts` → 18/18 pass
- `npx jest` (full suite) → 430/430 pass, 24 suites
- `npx tsc --noEmit -p tsconfig.build.json` → clean (exit 0)

---

## Summary

The implementation correctly delivers the milestone and — critically — fixes the rollback-on-throw flaw that sank plan-review-1. The transaction callback now returns a discriminated `VerifyOutcome` (`'invalid' | 'locked' | 'ok'`) and persists the counter/lock on the **return** path; the 401/429 are thrown **after** the transaction commits (`auth-code.service.ts:108-186`). The `pessimistic_write` lock is retained, so concurrent verifies serialize and the increment stays correct. No blocking bugs, security regressions, or correctness defects found.

## Correctness verification

- **The headline fix is real.** Mismatch branch (`:130-143`) increments `failedAttempts`, conditionally sets `lockedUntil`, `await manager.save(authCode)`, then `return { outcome: 'invalid' }`. Because the callback returns rather than throws, the write commits. The 401 is raised at `:180-183` outside the transaction. This is exactly the structure the plan prescribed.
- **Concurrency is sound.** `setLock('pessimistic_write')` on the email-scoped load (`:113-118`) means a second concurrent verify blocks on `SELECT … FOR UPDATE` until the first commits, then re-reads the incremented row (Postgres READ COMMITTED + row lock). Increments cannot be lost to a race.
- **Single-active-row invariant holds.** `sendCode` still does `delete({ email })` + insert (`:73-81`), so the `orderBy createdAt DESC` / `getOne` load returns the one active row. Counter resets per resend as intended; it is not carried across codes.
- **Lock short-circuit precedes hash compare** (`:124-126`) — once locked, even a correct code yields 429 until the user requests a new one. This matches the spec ("Too many attempts, request a new code") and is the intended behavior, not a bug.
- **Type fidelity.** `failedAttempts` is `smallint` → TypeORM returns it as a JS `number` (unlike `numeric`/`bigint` which return strings), so `+= 1` is arithmetic, not string concat. `lockedUntil` is `timestamp` → returns a JS `Date`, so `authCode.lockedUntil > new Date()` compares correctly.
- **Migration is additive and auto-discovered.** `failedAttempts smallint NOT NULL DEFAULT 0` back-fills existing rows; `lockedUntil TIMESTAMP NULL` is nullable. `down` drops in reverse order. Both `typeorm.config.ts` and `database.config.ts` load migrations via glob (`src/migrations/*`), so the file runs on startup with no registration step. Entity/migration column types agree (`timestamp`), resolving plan-review W1.
- **gRPC + REST parity.** The 429 is an `HttpException(TOO_MANY_REQUESTS)`, identical in shape to the existing `sendCode` cooldown path that `GrpcExceptionFilter` already maps to `RESOURCE_EXHAUSTED` — so mobile distinguishes "locked" from "wrong code" by status.

## Security

- **No message-based enumeration.** Both null-row and hash-mismatch return the same `'Invalid or expired code'` (`:120-122`, `:142`). The 429 path does reveal an active code exists, but only after the attacker themselves triggered the lock — no new information leak. Accepted residual, consistent with the spec.
- **No PII in logs.** Logs carry `codeId` / `userId` / attempt count only (`:139-141`, `:163-165`, `:181`) — no email or code, per project rules.

## Test quality

The spec asserts the **observable post-commit contract**, as the plan demanded: thrown `UnauthorizedException` on mismatch (`:331-346`), `failedAttempts: 5` + future `lockedUntil` on the 5th miss (`:348-369`), and `HttpException(429)` + no token + not-marked-used on the locked short-circuit (`:371-390`). `hashOf` derives the expected digest the same way the service does (no hard-coded hashes), and both the shared `makeQb` and the inline "normalizes email" qb gained `orderBy` (resolving plan-review W2).

## Non-blocking observations (no change required)

1. **Double warn log on a wrong code.** A mismatch logs `verifyCode: wrong code …` inside the transaction (`:139-141`) and then `verifyCode: invalid or expired code` again after it returns (`:181`). Two lines per failed attempt — slightly noisy but harmless; the first carries the useful `codeId`/`attempts` detail. Could collapse to one if log volume matters.
2. **Non-constant-time hash compare** (`:129`, `!==`). Pre-existing pattern (the prior code compared via DB equality); not a regression. Practically unexploitable here since the stored hash derives from a server-generated random code the attacker is trying to guess. No action needed.
3. **Orphaned `IDX_auth_codes_code_hash`** — now unused by any query since the load is by email. The plan explicitly deferred this as out of scope; flagged here only so it isn't silently forgotten in a future cleanup.

---

REVIEW_PASS
