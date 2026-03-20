# Review: Sync REST Endpoint (iteration 1)

## Files reviewed
- `src/sync/dto/sync-changes.dto.ts`
- `src/sync/sync.service.ts`
- `src/sync/sync.controller.ts`
- `src/sync/sync.module.ts`
- `src/app.module.ts` (diff only)

## Issues

### 1. [Bug] Response events contain `userId` — contradicts plan and DTO

`SyncService.getChanges()` returns raw `ChangeEvent` entities from `ChangeLogService.getChanges()`. The `ChangeEvent` entity has a `userId` column. Since the controller returns the result directly without mapping, every event object in the JSON response will include `userId`.

The plan explicitly states: *"Do not expose `userId` — the endpoint is already scoped to the authenticated user."* The `SyncEventDto` correctly omits `userId`, but it's only a Swagger documentation class — it's never used for serialization.

**Fix:** Map `ChangeEvent[]` to `SyncEventDto[]` in the service or controller. Destructure out `userId` and `user`:

```typescript
const mapped = events.map(({ userId, user, ...rest }) => rest);
```

**Location:** `src/sync/sync.service.ts:19` or `src/sync/sync.controller.ts:37`

---

### 2. [Bug] Swagger `oneOf` $refs will not resolve

The controller uses raw `schema.oneOf` with `$ref` pointers to `SyncChangesResponseDto` and `SyncFullResyncResponseDto`. These DTOs are never passed to a `type:` parameter anywhere, and the project does not use `@ApiExtraModels`. NestJS Swagger only auto-registers schemas that it encounters through `type:` — raw `$ref` strings pointing to unregistered schemas produce broken links in the Swagger UI.

**Fix:** Add `@ApiExtraModels` to the method or class:

```typescript
@ApiExtraModels(SyncChangesResponseDto, SyncFullResyncResponseDto)
```

**Location:** `src/sync/sync.controller.ts:18` (class level) or on the method

---

### 3. [Style] Inconsistent cross-module import path

`sync.service.ts` uses a relative import for `ChangeLogService`:
```typescript
import { ChangeLogService, ChangesResult } from '../changelog/changelog.service';
```

The rest of the sync module and the codebase convention use absolute `src/` paths for cross-module imports (e.g. `import { JwtAuthGuard } from 'src/users/guards/jwt-auth.guard'`). Both resolve correctly thanks to tsconfig `paths`, but the inconsistency is unnecessary.

**Fix:** Change to `'src/changelog/changelog.service'`.

**Location:** `src/sync/sync.service.ts:2`

---

### 4. [Style] Missing blank line before `SyncModule` import in app.module.ts

The `SyncModule` import statement is crammed against the `ChangelogModule` import without the blank line that separates the other import groups.

**Location:** `src/app.module.ts:15`

## Summary

| # | Severity | Category | Description |
|---|----------|----------|-------------|
| 1 | Medium | Correctness | `userId` leaks in response events — plan says not to expose it |
| 2 | Low | Swagger | `oneOf` $refs will be broken without `@ApiExtraModels` |
| 3 | Low | Style | Relative import for cross-module dependency |
| 4 | Low | Style | Missing blank line in imports |

No critical issues. Issues 1 and 2 are bugs that should be fixed before merging. Issues 3-4 are stylistic.

REVIEW_PASS
