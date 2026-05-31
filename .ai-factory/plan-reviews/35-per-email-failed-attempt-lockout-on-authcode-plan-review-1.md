# Plan Review: Per-email failed-attempt lockout on `AuthCode`

**Plan:** `35-per-email-failed-attempt-lockout-on-authcode.md`
**Files cross-checked:** `auth-code.service.ts`, `auth-code.service.spec.ts`, `auth-code.entity.ts`, `1774863293946-InitialSchema.ts`, `1779369537954-AddBciDevicesTable.ts`, `auth.grpc.controller.ts`, `grpc-exception.filter.ts`
**Risk Level:** 🔴 High — the core mechanism does not persist as designed.

---

## Critical Issues (must fix before implementation)

### 1. The failed-attempt increment is written inside the transaction, then thrown away by rollback

This is the headline defect — the feature, as planned, will **never lock anyone out.**

Task 3 step 3 (mismatch branch) says:

> `authCode.failedAttempts += 1`; … `await manager.save(authCode)`; then `throw new UnauthorizedException('Invalid or expired code')`.

All of this happens **inside** the existing `this.dataSource.transaction(async (manager) => { … })`. TypeORM's `DataSource.transaction()` commits only when the callback **returns**, and **rolls back when the callback throws**. Because the mismatch branch calls `manager.save(authCode)` and then throws out of the same callback, the increment (and, on the 5th miss, the `lockedUntil` write) is rolled back and never reaches the database.

Consequences:
- `failedAttempts` stays at 0 forever; the `>= 5` threshold is never reached.
- `lockedUntil` is never persisted, so the step-2 short-circuit (429) can never trigger.
- The entire lockout is inert. The plan ships schema + dead code.

The current happy path works precisely because it **returns** (commit). The failure path needs the same treatment for its write.

**Fix direction (pick one, then restate Task 3 accordingly):**
- **Preferred — commit the mutation, throw outside the transaction.** Have the transaction callback do the load + lock-check + hash-compare and *return a discriminated result* (e.g. `{ outcome: 'locked' | 'mismatch' | 'ok', dto? }`), persisting the counter/lock with `manager.save` on the mismatch path and returning normally so the transaction commits. After the transaction returns, inspect the result and `throw` the 401/429 from outside. This keeps the `pessimistic_write` lock guarding the increment.
- **Alternative — persist the counter on a separate write.** Use an atomic `UPDATE "auth_codes" SET "failedAttempts" = "failedAttempts" + 1 …` (e.g. `authCodeRepository.increment(...)` / `update(...)`) issued outside the failing transaction before throwing. Simpler, but drops the pessimistic-lock serialization the plan explicitly wanted to keep, so prefer the first option.

### 2. The spec design (Task 4) masks Issue #1 — tests would pass on broken code

Task 4 asserts:

> a case where the loaded row's `codeHash` does NOT match … expects `UnauthorizedException` and that `manager.save` was called with an incremented `failedAttempts`.

The mocked `manager.save` is a `jest.fn()` and the mock `dataSource.transaction` just invokes the callback — **it does not model rollback-on-throw.** So "`manager.save` was called with `failedAttempts: 5`" will be green even though the real database rolls that write back. The test gives false confidence in exactly the broken behavior from Issue #1.

After restructuring per Issue #1, assert on the **observable post-commit contract** (the thrown 401 after N misses, the 429 after lock), not merely "save was called inside the doomed transaction." If you keep an inline transaction mock, make it propagate the thrown error the way the real one does so a rolled-back path can't be mistaken for a committed one.

---

## Warnings (non-blocking, but address)

### W1. `lockedUntil` column type diverges from the table's existing style

Task 1 says "mirroring the existing column style," then specifies `@Column({ type: 'timestamptz', … })`, and Task 2 emits `timestamptz`. But every existing temporal column on `auth_codes` is plain `TIMESTAMP` (without time zone): `createdAt` and `expiresAt` are `TIMESTAMP` in `InitialSchema`, and the entity declares `expiresAt` as `type: 'timestamp'`. Mixing `timestamp` and `timestamptz` in the same table is functionally harmless here (JS `Date` comparisons work either way) but contradicts the stated "mirror existing style" intent. Either use `type: 'timestamp'` to match the table, or keep `timestamptz` as a deliberate choice and drop the "mirroring" wording. Be consistent between the entity decorator and the migration SQL.

### W2. Spec's inline query-builder mock in "normalizes email" needs `orderBy`

The reworked `verifyCode` query adds `.orderBy('ac.createdAt', 'DESC')`. Task 4 correctly says to add `orderBy` to the shared `makeQb`, but the "normalizes email to lowercase" test (spec lines ~282–298) builds its **own** inline qb object that currently lacks `orderBy`. If left as-is, `.orderBy(...)` is `undefined` → `TypeError` and the test breaks. Add `orderBy: jest.fn().mockReturnThis()` to that inline mock (or have it reuse `makeQb`). Task 4 mentions updating that case's `andWhere` assertion but not its `orderBy` — call it out explicitly.

### W3. Dead index left behind (out of scope, but note it)

Once `verifyCode` loads by email instead of `codeHash`, `IDX_auth_codes_code_hash` is no longer used by any query (`sendCode` doesn't use it either). The plan is additive-only, which is fine, but the index becomes pure write overhead. Acceptable to defer, just acknowledge it rather than leave it silently orphaned.

---

## Notes (accepted residual / informational)

- **gRPC parity confirmed.** The plan's claim that the 429 is shared by REST and gRPC checks out: `GrpcExceptionFilter` maps HTTP `429 → RESOURCE_EXHAUSTED`, and `verifyCode` in `auth.grpc.controller.ts` delegates straight to the service under `@UseFilters(GrpcExceptionFilter)`. The new `HttpException(..., TOO_MANY_REQUESTS)` will surface correctly on both transports, identically to the existing `sendCode` rate-limit path.
- **Column naming verified.** The DB uses quoted camelCase identifiers (no snake naming strategy — `"codeHash"`, `"expiresAt"` in `InitialSchema`), so the plan's `"failedAttempts"` / `"lockedUntil"` SQL is correct. Good that the plan didn't assume snake_case.
- **`failedAttempts smallint NOT NULL DEFAULT 0`** is back-fill-safe for existing rows; `lockedUntil` nullable with no default is fine. Migration `up`/`down` shape matches the raw-SQL `queryRunner.query` style of existing migrations.
- **Counter reset via resend** — `sendCode` deletes + reinserts (fresh `failedAttempts = 0`) under a 60s cooldown. The plan treats this as the intended reset. Worth noting the residual: an attacker can obtain 5 fresh guesses per 60s, but each resend rotates to a new random code, so guesses don't accumulate against a fixed target. Acceptable for the stated goal.
- **Lock-beyond-expiry is moot.** Because the load query filters `expiresAt > now` and both the code lifetime and the lock window are 15 min, a lock set on a late miss expires together with (or after) the code. That's fine — once the code expires the user must request a new one anyway. No change needed; just be aware the lock only bites within the code's remaining lifetime.
- **Message parity is good for security.** Reusing `'Invalid or expired code'` for both the null-row and hash-mismatch cases avoids leaking whether the email has an active code. Keep it.

---

## Verdict

The schema work (Tasks 1–2) is sound modulo the `timestamptz` style nit (W1). The logic design (Task 3) has a **correctness-fatal flaw**: persisting the attempt counter with `manager.save` and then throwing inside `dataSource.transaction` rolls the write back, so the lockout never engages — and the planned tests (Task 4) would pass anyway, hiding it. Restructure Task 3 to commit the counter/lock before throwing (return-then-throw outside the transaction), and rewrite Task 4 to assert the post-commit contract rather than the in-transaction `save` call.

Do not implement as written.
