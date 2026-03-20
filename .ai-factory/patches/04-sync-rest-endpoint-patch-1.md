# Patch: Sync REST Endpoint — Review 1

Source: `.ai-factory/reviews/04-sync-rest-endpoint-review-1.md`

---

## Fix 1: Strip `userId` from response events

**File:** `src/sync/sync.service.ts`
**Problem:** `getChanges()` returns raw `ChangeEvent` entities which include `userId`. The plan requires userId not to be exposed in the response.

**What to change:**

Replace the return type and the success-path return statement. Instead of forwarding raw `ChangesResult` (which contains `ChangeEvent[]`), define a stripped interface and map the entities.

Add a new interface after the existing imports (line 3):

```typescript
interface SyncChangesResult {
  events: { id: number; entity: string; refId: string; action: string; createdAt: Date }[];
  cursor: number;
  hasMore: boolean;
}
```

Change the method return type on line 20 from:

```typescript
  ): Promise<ChangesResult | { fullResync: true }> {
```

to:

```typescript
  ): Promise<SyncChangesResult | { fullResync: true }> {
```

Replace line 27:

```typescript
    return this.changeLogService.getChanges(userId, afterId, limit);
```

with:

```typescript
    const result = await this.changeLogService.getChanges(userId, afterId, limit);
    return {
      ...result,
      events: result.events.map(({ id, entity, refId, action, createdAt }) => ({
        id, entity, refId, action, createdAt,
      })),
    };
```

Remove the `ChangesResult` import from line 3 (no longer used):

```typescript
// Before
import { ChangeLogService, ChangesResult } from '../changelog/changelog.service';

// After
import { ChangeLogService } from '../changelog/changelog.service';
```

---

## Fix 2: Register Swagger extra models for `oneOf` refs

**File:** `src/sync/sync.controller.ts`
**Problem:** `@ApiResponse` uses `$ref` pointers to `SyncChangesResponseDto` and `SyncFullResyncResponseDto`, but these schemas are never registered with the Swagger plugin. The `$ref` links will be dead in Swagger UI.

**What to change:**

Add `ApiExtraModels` to the import from `@nestjs/swagger` on lines 2-7:

```typescript
// Before
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

// After
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
```

Add `@ApiExtraModels` decorator to the controller class on line 16 (before `@ApiTags`):

```typescript
// Before
@ApiTags('sync')
@Controller('sync')
export class SyncController {

// After
@ApiExtraModels(SyncChangesResponseDto, SyncFullResyncResponseDto)
@ApiTags('sync')
@Controller('sync')
export class SyncController {
```

---

## Fix 3: Use absolute import path for cross-module dependency

**File:** `src/sync/sync.service.ts`
**Problem:** Uses relative `'../changelog/changelog.service'` for a cross-module import. Project convention is absolute `'src/...'` paths for cross-module imports.

**What to change:**

Replace line 3 (after Fix 1 has already removed `ChangesResult`):

```typescript
// Before
import { ChangeLogService } from '../changelog/changelog.service';

// After
import { ChangeLogService } from 'src/changelog/changelog.service';
```
