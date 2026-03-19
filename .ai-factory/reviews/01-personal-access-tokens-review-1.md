# Review: Personal Access Tokens — Iteration 1

**Plan:** `.ai-factory/plans/01-personal-access-tokens.md`
**Scope:** 6 new files, 4 modified files

---

## Bug: `GET /auth/tokens` leaks `tokenHash` to the client

**Severity:** High
**File:** `src/users/service/personal-access-token.service.ts:33-38`

`list()` returns full `PersonalAccessToken[]` entity instances. The controller declares `TokenResponseDto[]` as the return type, but TypeScript types are erased at runtime — NestJS serializes the actual object. There is no `ClassSerializerInterceptor`, no `@Exclude()` on the entity, and no DTO mapping.

The JSON response will include **`tokenHash`** and **`userId`** in addition to the expected fields. While SHA-256 of 32 random bytes is computationally infeasible to reverse, exposing internal hashes violates the project's own conventions (OTP hashes and session hashes are never exposed) and leaks implementation details.

**Fix:** Map entities to DTOs in the service or use `select` to only fetch needed columns:

```typescript
async list(userId: string): Promise<TokenResponseDto[]> {
  const tokens = await this.patRepo.find({
    where: { userId },
    order: { createdAt: 'DESC' },
    select: ['id', 'name', 'createdAt', 'lastUsedAt'],
  });
  return tokens;
}
```

---

## Bug: Duplicate unique index on `tokenHash`

**Severity:** Moderate
**File:** `src/migrations/1773909111537-CreatePersonalAccessTokensTable.ts:18,26-28`

The migration creates both a `UNIQUE` constraint (line 18) and a separate `CREATE UNIQUE INDEX` (lines 26-28) on `tokenHash`. In PostgreSQL, a UNIQUE constraint automatically creates a unique index internally. The result is two indexes on the same column — wasted storage and slower writes.

**Fix:** Remove the explicit `CREATE UNIQUE INDEX` statement on lines 26-28. The UNIQUE constraint on line 18 is sufficient.

---

## Minor: No `ParseUUIDPipe` on `DELETE /auth/tokens/:id`

**Severity:** Low
**File:** `src/users/auth.controller.ts:142`

Passing a non-UUID string as `:id` will cause a raw Postgres error (500 Internal Server Error) rather than a clean 400 Bad Request. This is consistent with existing patterns in the codebase (no other endpoint uses `ParseUUIDPipe`), but worth noting.

---

## Observation: `POST /auth/logout` is a no-op when authenticated with a PAT

When a user authenticates with a PAT and calls `POST /auth/logout`, `AuthService.logout()` extracts the Bearer token and calls `sessionService.revoke(token)`. Since PATs don't create entries in `user_sessions`, the revoke finds nothing and returns silently. The endpoint succeeds but doesn't actually revoke the PAT. Not a security issue — PATs are revoked via `DELETE /auth/tokens/:id` — but could confuse API consumers.

---

## Summary

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | `tokenHash` leaked in list response | High | Fix: add `select` or map to DTO |
| 2 | Duplicate unique index on `tokenHash` | Moderate | Fix: remove redundant `CREATE UNIQUE INDEX` |
| 3 | No UUID validation on delete param | Low | Optional |
| 4 | Logout no-op with PAT auth | Info | Optional |

Issues 1 and 2 should be fixed before merge.
