## Code Review Summary

**Files Reviewed:** 5
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — WARN: No violation. `SyncModule` correctly imports `AuthModule` for guards and consumes `ChangeLogService` through the global `ChangelogModule` export. Module boundary rules are followed.
- **RULES.md** — WARN: No violation. No `!` operator, no sensitive data in logs.
- **ROADMAP.md** — WARN: Milestone "Sync REST Endpoint" is marked `[x]`. Aligned.

### Critical Issues

**1. `userId` leaks in response events**
Files: `src/sync/sync.service.ts:27`, `src/sync/sync.controller.ts:38`

`ChangeLogService.getChanges()` returns full `ChangeEvent` entities. The `ChangeEvent` entity has a `userId` column (see `src/changelog/entities/change-event.entity.ts:28`). The controller returns the service result directly without any mapping, so every event object in the JSON response will include `userId`.

The plan explicitly requires: *"Do not expose `userId` — the endpoint is already scoped to the authenticated user."* The `SyncEventDto` correctly omits `userId`, but it is only a Swagger documentation class — no serialization interceptor or `ClassSerializerInterceptor` is applied, so the DTO has no effect on the actual response shape.

Fix — map entities before returning, either in the service or controller:

```typescript
// In sync.service.ts getChanges(), after getting the result:
const result = await this.changeLogService.getChanges(userId, afterId, limit);
return {
  ...result,
  events: result.events.map(({ id, entity, refId, action, createdAt }) => ({
    id, entity, refId, action, createdAt,
  })),
};
```

**2. Swagger `oneOf` `$ref` links will not resolve**
File: `src/sync/sync.controller.ts:28-31`

The `@ApiResponse` uses raw `schema.oneOf` with `$ref` pointers to `SyncChangesResponseDto` and `SyncFullResyncResponseDto`. NestJS Swagger only auto-registers schemas that it encounters through the `type:` parameter of `@ApiResponse`, `@ApiBody`, etc. These two DTOs are imported but never passed to a `type:` — they only appear as string references. Without registration, Swagger UI will show broken/empty references.

Fix — add `@ApiExtraModels` at the class or method level:

```typescript
import { ApiExtraModels } from '@nestjs/swagger';

@ApiExtraModels(SyncChangesResponseDto, SyncFullResyncResponseDto)
@ApiTags('sync')
@Controller('sync')
export class SyncController { ... }
```

### Suggestions

**3. Relative import for cross-module dependency**
File: `src/sync/sync.service.ts:3`

```typescript
import { ChangeLogService, ChangesResult } from '../changelog/changelog.service';
```

The project convention (visible in `sync.controller.ts:8`, `sync.module.ts:2`, and throughout `breath-sessions.controller.ts`) uses absolute `src/` paths for cross-module imports. This should be `'src/changelog/changelog.service'` for consistency.

### Positive Notes

- Service logic is clean — the full-resync detection (`afterId !== 0 && afterId < minEventId`) correctly handles both the initial sync case (`after=0`) and the pruned-cursor case.
- Module structure follows the established pattern: thin controller, logic in service, correct module imports.
- DTOs have proper `class-validator` and `class-transformer` decorators; `@Min(1)` on `limit` prevents `limit=0` from producing degenerate queries.
- The `@Type(() => Number)` decorators on query params handle the string-to-number coercion that NestJS query parsing requires.
