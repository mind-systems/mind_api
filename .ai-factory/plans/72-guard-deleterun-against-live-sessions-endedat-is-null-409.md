# Plan: Guard `deleteRun` against live sessions (`endedAt IS NULL` → 409)

## Context
Reject deletion of a non-finalized (live) `module_sessions` row in `SessionsService.deleteRun` so the realtime in-memory engines never end up referencing a deleted parent. Only finalized runs (`endedAt IS NOT NULL`) may be deleted; live ones return HTTP 409.

## Settings
- Testing: yes (milestone explicitly requires a unit test for the new branch)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Service guard

- [x] **Task 1: Make `assertSessionOwnership` return the loaded `ModuleSession`**
  Files: `src/sessions/sessions.service.ts`
  Change the private `assertSessionOwnership(userId, sessionId)` signature from `Promise<void>` to `Promise<ModuleSession>` and `return session;` after the ownership checks pass. This is backward-compatible — `listBiometrics`/`listInstructions` call it with `await` and ignore the return value, so they stay unchanged. Keep the existing 404 (`NotFoundException` when `!session`) → 403 (`ForbiddenException` when `userId` mismatch) order and the existing comment block (lines 102-104) intact. `ModuleSession` is already imported.

- [x] **Task 2: Reject live sessions in `deleteRun` with 409** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  In `deleteRun`, capture the helper's return: `const session = await this.assertSessionOwnership(userId, sessionId);`. After the ownership check and **before** `moduleSessionRepo.delete`, add the finalized guard:
  ```ts
  if (session.endedAt == null) {
    throw new ConflictException('Cannot delete a session that is still active');
  }
  ```
  Use loose `== null` to cover both `null` and `undefined`. Keep the existing `delete({ id: sessionId })` call and the existing log line unchanged afterward. Do NOT reach into `RealtimeModule` in-memory state — key strictly on the DB `endedAt` column (modular-monolith boundary). No migration, no proto, no module change; Phase 45 cascade / no-touch set (`breath_sessions`/`user_stats`/`meditation_notes`, no sync event) unchanged.

- [x] **Task 3: Import `ConflictException`** (depends on Task 2)
  Files: `src/sessions/sessions.service.ts`
  Add `ConflictException` to the existing `@nestjs/common` import block (alongside `ForbiddenException`, `NotFoundException`, etc.).

### Phase 2: Unit test

- [x] **Task 4: Add the live→409 test branch** (depends on Task 2)
  Files: `src/sessions/sessions.service.spec.ts`
  Add a new `describe('live session → 409', ...)` block beside the existing owned / foreign / missing cases. Use the existing `makeSession` helper with `{ endedAt: null, status: SessionStatus.ACTIVE }` (note: `makeSession` currently sets `status: COMPLETED` and no `endedAt`, so explicitly pass both). Mock `moduleSessionRepo.findOne` to resolve that session, assert `service.deleteRun('user-uuid', 'session-uuid')` rejects with `ConflictException` (import it from `@nestjs/common`), and assert `moduleSessionRepo.delete` was NOT called. Verify the existing owned-session success cases still pass — they set no `endedAt`, so update `makeSession`'s default or the owned-case overrides to include a non-null `endedAt` (e.g. `endedAt: new Date()`) to keep the 204/delete path green.

## Verification
- `npx jest src/sessions/sessions.service.spec.ts` — all four branches green (owned→delete, foreign→403, missing→404, live→409).
- `npm run build` — compiles with the new return type and import.
