# Plan: Delete the `ReplaceSession` RPC end-to-end

## Context
Remove the redundant `ReplaceSession` (PUT) breath-session path whose only behavior over `UpdateSession` (PATCH) is resetting server-managed `timeOfDay` to null on an absent field — the data-loss bug. After removal, `UpdateSession`/`update()` becomes the only edit path. No DB/schema/migration change. Spec: `.ai-factory/notes/50-remove-replacesession-rpc-patch-only.md`.

## Settings
- Testing: yes (milestone explicitly requires one regression test)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Remove the RPC path

- [x] **Task 1: Remove `ReplaceSession` from the proto contract and regenerate stubs**
  Files: `proto/breath_sessions.proto`, `proto/generated/breath_sessions.ts`
  In `proto/breath_sessions.proto` delete the `rpc ReplaceSession(ReplaceSessionRequest) returns (BreathSessionDto);` line (currently line 200) inside `service BreathSessionService`, and delete the entire `message ReplaceSessionRequest { ... }` block together with its leading PUT-semantics comment (currently lines 111-120). Leave every other RPC and message untouched (`CreateSession`, `UpdateSession`, `UpdateSessionSettings`, `DeleteSession`, etc.). Then run `npm run proto:gen` to regenerate `proto/generated/breath_sessions.ts` — the regenerated `BreathSessionServiceController` interface must no longer declare `replaceSession`, and `ReplaceSessionRequest` must be gone. Do NOT hand-edit the generated file; only regenerate it.

- [x] **Task 2: Remove the `replaceSession` gRPC handler and its import** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.grpc.controller.ts`
  Delete the `replaceSession` handler method (currently lines 170-194) and remove the `ReplaceSessionRequest` entry from the import block from `../../proto/generated/breath_sessions` (currently line 19). The class `implements BreathSessionServiceController` — after Task 1's regen the interface no longer declares `replaceSession`, so the method becomes dead and the dangling import would break compilation. Do NOT touch the `updateSession`, `createSession`, or any other handler. Keep `fromProtoExercises` / `fromProtoTimeOfDay` imports (still used by `createSession`/`updateSession`).

- [x] **Task 3: Remove the `replace()` service method and its DTO import** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  Delete the `replace()` method (currently lines 366-409) and remove `ReplaceBreathSessionDto` from the import block (currently line 17). Do NOT touch `update()` (currently around line 342) or `create()` — they remain the only mutation paths. Keep `calculateComplexity`, `changeLogService`, and event-emitter usage intact for the remaining methods.

- [x] **Task 4: Delete the `ReplaceBreathSessionDto` class** (depends on Task 3)
  Files: `src/breath-sessions/dto/breath-session.dto.ts`
  Remove the `export class ReplaceBreathSessionDto { ... }` class (currently lines 83-99). Leave `UpdateBreathSessionDto`, `CreateBreathSessionDto`, and all other DTOs untouched. Drop any `class-validator`/`class-transformer` imports that become unused only after this deletion (verify nothing else in the file uses them before removing).

### Phase 2: Tests and verification

- [x] **Task 5: Remove the `replace` spec block and add a `timeOfDay`-preservation regression test** (depends on Task 3)
  Files: `src/breath-sessions/breath-sessions.service.spec.ts`
  Delete the entire `describe('replace', () => { ... })` block (currently lines 127-165). Inside the existing `describe('update', ...)` block, add a test asserting that a session created with `timeOfDay` set is not wiped by an update that omits it: build `const existing = makeSession({ timeOfDay: <morning value> })`, `repository.findOne.mockResolvedValue(existing)`, call `service.update('session-uuid', 'user-uuid', { description: 'New desc' })` (no `timeOfDay` field), and `expect(result.timeOfDay).toBe(<morning value>)`. Use the project's `TimeOfDay` enum for the morning value (import from `./enums/time-of-day.enum` — check the existing enum's morning member name and reference it; do not hardcode a raw string if the enum differs). This proves the bug is gone by construction: `update()` uses `Object.assign(session, updateDto)` and never touches omitted fields.

- [x] **Task 6: Verify clean build and zero residual references** (depends on Tasks 1-5)
  Files: (none — verification only)
  Run `npm run build` (or `npx tsc --noEmit`) and confirm it compiles clean. Run `grep -rn "ReplaceSession\|replaceSession\|ReplaceBreathSessionDto" src proto` and confirm it returns nothing. Run `npm test -- breath-sessions.service.spec` and confirm the new `timeOfDay`-preservation test passes. If any residual reference remains, fix the owning file before finishing.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Remove redundant ReplaceSession RPC and its handler, service, and DTO"
- **Commit 2** (after tasks 5-6): "Add timeOfDay-preservation test for breath session update"
