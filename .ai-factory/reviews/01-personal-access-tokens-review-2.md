# Review: Personal Access Tokens — Iteration 2

**Plan:** `.ai-factory/plans/01-personal-access-tokens.md`
**Scope:** 6 new files, 4 modified files
**Previous review:** `01-personal-access-tokens-review-1.md`

---

## Review-1 fixes verified

1. **`tokenHash` leak fixed** — `list()` now uses `select: ['id', 'name', 'createdAt', 'lastUsedAt']` (service line 37). Unselected columns (`tokenHash`, `userId`) will be `undefined` on entity instances and omitted by `JSON.stringify`.

2. **Duplicate index fixed** — Migration now has only the UNIQUE constraint on `tokenHash` (line 18). The redundant `CREATE UNIQUE INDEX` was removed. Only the `userId` index remains as a separate statement.

---

## File-by-file check

**Entity** (`personal-access-token.entity.ts`) — Follows `UserSession` pattern. Column types and decorators match the migration SQL.

**Migration** (`1773909111537-...`) — Timestamp is the latest (> 1773652922852). `up()` creates table with PK, UNIQUE on tokenHash, index on userId. `down()` drops the table. Column types match the entity. Will be auto-discovered by both `database.config.ts` glob and `typeorm.config.ts` glob.

**Service** (`personal-access-token.service.ts`) — `create()` generates 32 random bytes with `pat_` prefix, hashes with SHA-256, stores hash, returns raw token once. `list()` uses `select` to exclude sensitive fields. `revoke()` checks ownership via `{ id, userId }`. `validateToken()` hashes input, looks up PAT, loads user, updates `lastUsedAt`, returns `JwtPayload`.

**JwtAuthGuard** — PAT branch (`pat_` prefix check) runs before JWT verification, avoiding wasted `verifyAsync` calls. Returns `UnauthorizedException` on invalid PAT. JWT path unchanged.

**OptionalJwtAuthGuard** — PAT branch inside existing `try/catch`, consistent with the guard's "silently fail" contract. Returns `true` regardless.

**Controller** — Three new endpoints with correct guards, decorators, and HTTP status codes. `@CurrentUser()` used consistently. `CreateTokenDto` validated with `@IsString()` + `@IsNotEmpty()`.

**Module** — Entity registered in `TypeOrmModule.forFeature`. Service in both `providers` and `exports`. DI graph is complete — guards can resolve `PersonalAccessTokenService` in any module that imports `AuthModule`.

**DTOs** — `CreateTokenDto`, `TokenResponseDto`, `CreateTokenResponseDto` all have `@ApiProperty` decorators for Swagger.

---

## Notes (non-blocking)

- **No `ParseUUIDPipe` on `DELETE /auth/tokens/:id`** — non-UUID input yields a Postgres error (500) instead of 400. Consistent with existing codebase patterns.
- **Logout with PAT is a no-op** — `AuthService.logout()` tries to revoke from `user_sessions`, finds nothing for PATs. Silently succeeds. Not a security issue.

---

No critical or moderate issues found.

REVIEW_PASS
