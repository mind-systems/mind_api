# Plan Review (2): Per-email failed-attempt lockout on `AuthCode`

**Plan:** `35-per-email-failed-attempt-lockout-on-authcode.md`
**Prior review:** `35-...-plan-review-1.md` (verdict: 🔴 do not implement)
**Files cross-checked:** `auth-code.service.ts`, `auth-code.entity.ts`, `1774863293946-InitialSchema.ts`, `src/migrations/*` (style + latest timestamp), prior review notes on `auth.grpc.controller.ts` / `grpc-exception.filter.ts`
**Risk Level:** 🟢 Low — every blocking issue from review-1 is resolved; design now matches the codebase.

> Tooling note: the file-reading tools intermittently returned corrupted/looping output during this pass. Core assumptions were verified against clean reads of the service, entity, and initial-schema migration; the remaining items (spec line ranges, gRPC parity, column naming) are corroborated by review-1, which was authored against the live codebase and whose line citations match this plan exactly.

---

## How this revision answers review-1

| Review-1 finding | Status in v2 |
|---|---|
| **Critical #1** — counter `save` + `throw` inside `dataSource.transaction` is rolled back; lockout never engages | **Resolved.** New "Critical design constraint" section + Task 3 restructured: the transaction callback persists the counter/lock and **returns a discriminated outcome** (`'invalid'` / `'locked'` / `'ok'`); the 401/429 is thrown by the caller **after commit**. The write is now on the return path, so it survives. |
| **Critical #2** — spec asserts on in-transaction `save`, masking the rollback bug | **Resolved.** Task 4 explicitly asserts the observable thrown outcome (401/429) and the returned token, and calls out that the inline `transaction` mock does not model rollback-on-throw — so "save was called" is no longer the contract. |
| **W1** — `timestamptz` contradicts the table's `TIMESTAMP` columns | **Resolved.** Task 1 and Task 2 now both use `type: 'timestamp'` / `TIMESTAMP`, with reasoning tied to `expiresAt`/`createdAt`. Entity decorator and migration SQL are consistent. |
| **W2** — `normalizes email` inline qb mock lacks `orderBy` → `TypeError` | **Resolved.** Task 4 explicitly adds `orderBy: jest.fn().mockReturnThis()` to that inline mock and updates its `andWhere` assertion to the email-only predicate. |
| **W3** — `IDX_auth_codes_code_hash` becomes dead once load-by-email lands | **Acknowledged.** Task 3 flags it as out-of-scope rather than silently orphaning it. |

---

## Independent verification

- **Transaction semantics** — confirmed `verifyCode` wraps its work in `this.dataSource.transaction(async (manager) => …)` and currently returns the auth DTO on the happy path (commit) and throws on the null-row path. The plan's return-then-throw restructure is the correct shape and preserves the `pessimistic_write` lock around the increment.
- **Column type** — confirmed the entity declares `expiresAt` as `type: 'timestamp'` and `InitialSchema` emits `"expiresAt" TIMESTAMP` / `"createdAt" TIMESTAMP`. `type: 'timestamp'` + `TIMESTAMP` for the two new columns matches the table. `Date` comparisons for `lockedUntil > now` work regardless of tz, so no functional risk.
- **Migration mechanics** — additive `ALTER TABLE`, `failedAttempts smallint NOT NULL DEFAULT 0` (back-fill-safe), `lockedUntil TIMESTAMP NULL`, CLI-generated timestamp, raw `queryRunner.query(...)` style, `down` drops both columns. Consistent with existing migrations and the project's "never hand-craft timestamps" rule.
- **Imports** — `HttpException`, `HttpStatus`, `UnauthorizedException`, and `createHash` are already imported in the service; the 429 path needs no new import. `MAX_FAILED_ATTEMPTS` / `LOCK_MINUTES` as private static consts follow the existing `CODE_EXPIRY_MINUTES` convention (no magic numbers).
- **`codeHash` uniqueness** — the column carries `@Column({ unique: true })`; switching the lookup to email-only does not touch that constraint (still one row per hash), and `orderBy('ac.createdAt','DESC').getOne()` correctly selects the latest active code.

## Context Gates

- **Architecture (`ARCHITECTURE.md`)** — WARN (not re-read this pass due to tooling). The change stays inside `AuthModule`/users domain: entity owned by its module, logic in `AuthCodeService`, schema via migration. No new cross-module coupling — consistent with the modular-monolith boundaries described in the project docs.
- **Rules (`RULES.md`)** — WARN (not re-read this pass). Plan explicitly honors the known project rules: CLI-generated migration timestamp, additive/back-fill-safe schema, PII-free lean logging (codeId/outcome only), English-only artifacts.
- **Roadmap (`ROADMAP.md`)** — WARN (not re-read this pass). This is a security-hardening (`fix`/`feat`) item; confirm it is linked to its roadmap milestone at implementation time.

No ERROR-level gate violations identified.

---

## Security & correctness notes (accepted residuals)

- **Message parity** — reusing `'Invalid or expired code'` for both null-row and hash-mismatch avoids leaking whether an active code exists for the email. Correct.
- **429 surfaced as a distinct outcome** — `HttpException(..., TOO_MANY_REQUESTS)` is thrown only on the lock short-circuit, mapped to `RESOURCE_EXHAUSTED` on gRPC by `GrpcExceptionFilter` (per review-1). Both transports share the lockout.
- **Counter scope / reset** — per-code, reset because `sendCode` deletes + reinserts a fresh row (`failedAttempts = 0`) under a 60s cooldown. Residual: an attacker gets 5 guesses per resend, but each resend rotates to a new random code, so guesses never accumulate against a fixed target. Acceptable for the stated goal.
- **Lock-within-lifetime** — the load filters `expiresAt > now`; with a 15-min code TTL and 15-min lock the lock only bites within the code's remaining lifetime, after which a new code is required anyway. No change needed.

## Minor suggestion (non-blocking)

- Task 3 step 1 uses `new Date()` for the `expiresAt > :now` filter and step 3 uses `Date.now()` for `lockedUntil`. Both are fine; just ensure the implementation reads "now" once per branch for readability — not a correctness issue.

---

## Verdict

The revision fully addresses the correctness-fatal rollback flaw and the test-masking issue from review-1, fixes the column-type and mock-`orderBy` warnings, and acknowledges the dead index. All independently verifiable codebase assumptions (transaction semantics, column types, migration style, imports, naming) check out. The plan is implementable as written.

PLAN_REVIEW_PASS
