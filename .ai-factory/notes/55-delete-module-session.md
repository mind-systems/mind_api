# Delete a module-session (web dashboard cleanup)

**Date:** 2026-06-21
**Source:** conversation context

## Key Findings

- The web dashboard lists **`module_sessions`** rows via `GET /sessions/runs`; each row's `id` is a `module_sessions.id`. "Delete a session" = hard-delete one `module_sessions` row.
- Deleting a `module_sessions` row already cascades to its child sample tables — **no manual child deletes needed**. FK `ON DELETE CASCADE` is defined in migrations for both `session_stream_samples` (instructions) and `bio_session_samples` (biometrics).
- `breath_sessions` is a **separate domain** (a breath *exercise*, not a session run). `module_sessions.activityRefId` is only a display pointer to which exercise/pose was performed — **do not delete the `breath_sessions` row**.
- `user_stats` is an **append-only cumulative snapshot** (`finalise()` does `+= 1` / `+= duration` and path-dependent streak/complexity). It is never recomputed and **must not be touched** on delete — stats are historical, by design.
- `meditation_notes.session_id` FK is `ON DELETE SET NULL` (Phase 30, by design so notes survive). Deleting the session nulls the link automatically — **the note survives, do not delete it**.
- `module_sessions` changes are **not** tracked in the `change_events` sync journal (only `breath_sessions` is). So **no changelog event** on delete; the web simply refetches.

## Details

### Scope — single atomic milestone

Add `DELETE /sessions/runs/:id` to the existing REST `SessionsController` + a `deleteRun` method on `SessionsService`. Both ship together (a route without the service method is non-functional). No migration, no proto, no gRPC, no new module.

### Controller — `src/sessions/sessions.controller.ts`

`SessionsController` is REST, `@Controller('sessions')` + `@UseGuards(JwtAuthGuard)`. Add:

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

Import `Delete`, `HttpCode` from `@nestjs/common` (the file already imports `Get`, `Param`, `ParseUUIDPipe`, `Query`, `UseGuards`). `JwtPayload`/`CurrentUser`/`JwtAuthGuard` already imported.

### Service — `src/sessions/sessions.service.ts`

There is already a private `assertSessionOwnership(userId, sessionId)` (lines ~102-115): `findOne({ where: { id } })` → `NotFoundException` if missing, `ForbiddenException` if `session.userId !== userId`. Reuse it.

```ts
async deleteRun(userId: string, sessionId: string): Promise<void> {
  await this.assertSessionOwnership(userId, sessionId);
  await this.moduleSessionRepo.delete({ id: sessionId });
  this.logger.log(`Deleted module session ${sessionId} for user ${userId}`);
}
```

`moduleSessionRepo` is already injected (used by `listRuns`/`assertSessionOwnership`). `new Logger(SessionsService.name)` per project logging rule.

Use `repo.delete({ id })` (hard delete) — `ModuleSession` has no `@DeleteDateColumn`, so there is no soft-delete option here, and hard delete is what triggers the DB-level cascade.

### What the cascade removes automatically (verify, do not hand-delete)

- `session_stream_samples` (instructions) — FK `FK_session_stream_samples_moduleSessionId … ON DELETE CASCADE` (InitialSchema migration).
- `bio_session_samples` (biometrics) — FK `FK_bio_session_samples_moduleSessionId … ON DELETE CASCADE` (AddBioSessionSamplesTable migration).

### Guards (do NOT)

- Do not delete or soft-delete `breath_sessions` / `breath_session_settings` (separate domain; `activityRefId` is a pointer only).
- Do not modify `user_stats` (append-only historical snapshot).
- Do not delete `meditation_notes` (FK already `SET NULL`s the link; note must survive).
- Do not emit a `change_events`/sync event (`module_sessions` is not in the journal).
- No migration, no proto change.

### Verify

- `DELETE /sessions/runs/:id` for an owned, ended session → 204; row gone from `module_sessions`; `session_stream_samples` and `bio_session_samples` rows for that `moduleSessionId` gone; any `meditation_notes` row for it has `session_id = NULL` but still exists.
- Another user's session id → 403; unknown id → 404.
- `user_stats` row for the user unchanged after delete.
- Unit test the three branches (owned → deletes; foreign → 403; missing → 404), mirroring the existing `SessionsService` spec style.

## Open Questions

None — scope, ownership, cascade, and the no-touch set are all settled.
