# Plan: DELETE /sessions/runs/:id + SessionsService.deleteRun

## Context
Add a hard-delete path for `module_sessions` rows so the web dashboard can remove a session run; child sample tables drop via existing FK `ON DELETE CASCADE`, and the separate breath/stats/notes domains stay untouched.

## Settings
- Testing: yes (milestone explicitly requires unit tests)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Service

- [x] **Task 1: Add `deleteRun` to `SessionsService`**
  Files: `src/sessions/sessions.service.ts`
  Add a `private readonly logger = new Logger(SessionsService.name);` field (import `Logger` from `@nestjs/common`). Add `async deleteRun(userId: string, sessionId: string): Promise<void>`: call the existing private `assertSessionOwnership(userId, sessionId)` (already throws `NotFoundException` on missing, `ForbiddenException` on foreign owner), then `await this.moduleSessionRepo.delete({ id: sessionId });` (hard delete — `ModuleSession` has no `@DeleteDateColumn`; the hard delete is what triggers the DB cascade). Then `this.logger.log(\`Deleted module session ${sessionId} for user ${userId}\`);`.
  Do NOT hand-delete `session_stream_samples` or `bio_session_samples` — their FKs cascade. Do NOT touch `breath_sessions`/`breath_session_settings`, `user_stats`, `meditation_notes`, and emit NO `change_events`/sync event.

### Phase 2: REST route

- [x] **Task 2: Add `@Delete('runs/:id')` to `SessionsController`** (depends on Task 1)
  Files: `src/sessions/sessions.controller.ts`
  Add `Delete` and `HttpCode` to the existing `@nestjs/common` import. Add a handler mirroring the existing `runs/:id` getters:
  ```ts
  @Delete('runs/:id')
  @HttpCode(204)
  deleteRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.deleteRun(user.sub, id);
  }
  ```
  `ParseUUIDPipe`, `Param`, `CurrentUser`, `JwtPayload`, `JwtAuthGuard` are already imported; the controller is already `@UseGuards(JwtAuthGuard)`.

### Phase 3: Tests

- [x] **Task 3: Unit-test `deleteRun`** (depends on Task 1)
  Files: `src/sessions/sessions.service.spec.ts` (new)
  Follow the existing spec style in `src/breath-sessions/breath-session-settings.service.spec.ts` — instantiate `new SessionsService(moduleSessionRepo, bioSampleRepo, streamSampleRepo)` with plain `jest.fn()` mocks (`findOne`, `delete` on the module-session repo; the bio/stream repos can be empty mocks). Cover three branches:
  - **owned → delete + cascade:** `moduleSessionRepo.findOne` resolves a session with `userId` matching the caller; assert `moduleSessionRepo.delete` is called with `{ id: sessionId }` and resolves; assert the bio/stream repos' `delete` is NOT called (cascade is DB-level, not service-level).
  - **foreign → 403:** `findOne` resolves a session whose `userId` differs; assert it rejects with `ForbiddenException` and `delete` is never called.
  - **missing → 404:** `findOne` resolves `null`; assert it rejects with `NotFoundException` and `delete` is never called.
  Since `user_stats` is never referenced by `deleteRun`, no stats repo is involved — note in a comment that stats are untouched by design (the milestone's "user_stats unchanged" guarantee holds because the service has no path to it).
