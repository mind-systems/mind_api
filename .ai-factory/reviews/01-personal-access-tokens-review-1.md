## Code Review Summary

**Files Reviewed:** 10 (6 new, 4 modified)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — WARN: Entity has `@Index()` on `tokenHash` alongside `{ unique: true }`, which is technically redundant (unique constraint already creates an index). However, `synchronize: false` means the decorator is metadata-only, and this exactly mirrors the `UserSession` entity pattern (`@Index()` + `@Column({ unique: true })` on `tokenHash`). Consistent, no action needed.
- **RULES.md** — OK. No non-null assertions in new code. No sensitive data logged (no logger added to the service at all, which aligns with "keep logs lean").
- **ROADMAP.md** — OK. Milestone marked `[x]` in roadmap, matches plan scope exactly.

### Critical Issues

None.

### Suggestions

**1. No `@MaxLength()` on `CreateTokenDto.name`**
File: `src/users/dto/create-token.dto.ts:8`

The `name` field has `@IsString()` + `@IsNotEmpty()` but no length cap. The DB column is `character varying` without a limit — PostgreSQL will accept strings up to ~1GB. A client could submit a megabyte-sized name string.

Add a reasonable length constraint:
```typescript
@MaxLength(100)
@IsString()
@IsNotEmpty()
name: string;
```

### Positive Notes

- **Previous review issues fixed:** `tokenHash` leak resolved via `select` in `list()`, duplicate unique index removed from migration.
- **Clean entity design** — follows the `UserSession` pattern precisely (column types, decorators, index strategy).
- **Migration is correct** — timestamp ordering is valid (`1773909111537` > `1773652922852`), `up()` and `down()` are symmetric, column types match the entity.
- **Guard integration is well-placed** — PAT check runs before JWT verification in `JwtAuthGuard`, avoiding wasted `verifyAsync` calls. `OptionalJwtAuthGuard` PAT branch is inside the existing `try/catch`, maintaining the guard's "silently fail" contract.
- **Service follows established patterns** — `hash()` method mirrors `SessionService.hash()`, `create()` returns raw token only once, `revoke()` enforces ownership via compound `{ id, userId }` criteria.
- **Module wiring is complete** — `PersonalAccessToken` registered in `TypeOrmModule.forFeature`, `PersonalAccessTokenService` in both `providers` and `exports`, guards can resolve the service in any module importing `AuthModule`.
- **WebSocket auth correctly unaffected** — `WsAuthMiddleware` only handles JWT verification, PATs are scoped to HTTP REST (CLI/MCP) as intended by the milestone.

REVIEW_PASS
