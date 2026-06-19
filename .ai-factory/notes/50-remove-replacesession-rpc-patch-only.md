# Remove ReplaceSession (PUT) — make breath-session edits PATCH-only

**Date:** 2026-06-19
**Source:** conversation context — `timeOfDay` data-loss root cause

## Key Findings

- Editing a breath session destroys its server-managed `timeOfDay`. Root cause is structural, not a missing null-check: edits go through **`ReplaceSession` (PUT)**, and `replace()` (`breath-sessions.service.ts:388`) does `session.timeOfDay = dto.timeOfDay ?? null`. The edit request carries no `time_of_day` (it is not part of the editable contract), so `request.timeOfDay === undefined` → controller passes `undefined` (`breath-sessions.grpc.controller.ts:187-190`) → the field is reset to `null` on every edit. The proto even documents this as intended: `breath_sessions.proto:113` — "time_of_day ... resets to null when absent".
- `time_of_day` is **server-managed** and never sent by edit/create requests. So a `ReplaceSession` edit silently wipes a field the editor never touched.
- **`UpdateSession` (PATCH) already covers every edit need — more safely.** Its fields are all `optional` with proto3 presence tracking, and `exercises` uses the `ExerciseList` wrapper so it can distinguish "not sent" (keep) from "sent empty" (clear all) — `breath_sessions.proto:99-110`. The service `update()` (line 342) does `Object.assign(session, updateDto)`, preserving any omitted field. So PATCH does full edits AND can clear exercises, without the absent-field-clobbers-data failure mode.
- **`ReplaceSession` has no purpose left.** Its only behavior over `Update` is the `timeOfDay`→null reset — which is exactly the bug; nothing needs PUT semantics. Decision: delete the RPC and the `replace()` path entirely rather than band-aid `replace()` with an `if` (which would leave the redundant PUT path and its PUT/PATCH inconsistency in place).

## Details

### The change
1. `proto/breath_sessions.proto` — delete the `rpc ReplaceSession(ReplaceSessionRequest) returns (BreathSessionDto);` line (currently 200) and the whole `message ReplaceSessionRequest { ... }` block + its PUT-semantics comment (currently 111-120). Run `npm run proto:gen` to regenerate `proto/generated/breath_sessions.ts` (drops `ReplaceSessionRequest` and the service method).
2. `src/breath-sessions/breath-sessions.grpc.controller.ts` — remove the `replaceSession` handler (170-194) and the `ReplaceSessionRequest` import (line 19). The class `implements BreathSessionServiceController`; after regen that interface no longer declares `replaceSession`, and the dangling import would otherwise fail to compile.
3. `src/breath-sessions/breath-sessions.service.ts` — remove the `replace()` method (366-409) and the `ReplaceBreathSessionDto` import (line 17).
4. `src/breath-sessions/dto/breath-session.dto.ts` — delete the `ReplaceBreathSessionDto` class (from line 83).
5. Tests — remove/adjust any spec referencing `replace`/`replaceSession`/`ReplaceBreathSessionDto` (grep `src/breath-sessions/*.spec.ts`).

### Guards (do NOT touch)
- `UpdateSession`/`update()` and `CreateSession`/`create()` — untouched; they remain the only mutation paths.
- `fromProtoExercises` — still used by create + update; keep the existing `?? []` guards.
- No DB/schema/migration change. The `timeOfDay` column and its values stay; this only removes the path that nulled them.
- Other RPCs in the service definition stay; only the `ReplaceSession` line is removed.

### Verify
- `npm run build` / `npx tsc` clean; `grep -rn "ReplaceSession\|replaceSession\|ReplaceBreathSessionDto" src proto` returns nothing.
- Editing via `UpdateSession` with only description/exercises/shared preserves `timeOfDay` (the bug is gone by construction).
- Add a test: a session with `timeOfDay='morning'` updated via `UpdateSession` (no `time_of_day` field) still reads back `morning`.

## Open Questions

- None. PATCH is a strict superset of the edit behavior (incl. clear-all-exercises via the `ExerciseList` wrapper); the only lost capability is nulling `timeOfDay` on an absent field, which is the bug being removed.
