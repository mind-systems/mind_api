# Plan Review: Client `client_timestamp_ms` on `ActivityStartCmd`/`ActivityEndCmd` → `startedAt`/`endedAt`

**Plan file:** `73-client-client-timestamp-ms-on-activitystartcmd-activityendcmd-startedat-endedat.md`
**Risk Level:** 🟢 Low

## Verdict

The plan is faithful to the authoritative spec note (`.ai-factory/notes/57-client-sourced-activity-timestamps.md`) and the ROADMAP item (line 273). All file paths, field numbers, line references, and the load-bearing watchdog reasoning were verified against the actual code. It is implementable as written. The notes below are minor accuracy improvements, none blocking.

## Context Gates

- **ARCHITECTURE.md** — present. No boundary violations: change stays within `RealtimeModule`; proto is owned by `mind_api` (proto-contract ownership respected — `mind_mobile`/`mind_mcp` regeneration is explicitly out of scope). **OK**
- **RULES.md** — present. Logging unchanged (`Logger`, not `console.*`); no migration fabricated. Commit messages avoid conventional-commit prefixes and use sentence case (matches global git rules). **OK**
- **ROADMAP.md** — milestone at line 273 directly matches this plan (open `[ ]` item). Linkage present. **OK** (`WARN` only that the item should be marked `[x]` on completion.)

## Verified Against Codebase

- **Field numbers (Task 1).** `ActivityStartCmd` currently `activity_type=1`, `optional ref_id=2`, `reserved 3` — adding `optional int64 client_timestamp_ms = 4` correctly skips the reserved tag. `ActivityEndCmd` is `{}`, so field `1` is free. Confirmed in `proto/module_state.proto:38-45`.
- **`proto:gen` script (Task 2).** Exists in `package.json:27`; generates into `proto/generated/`. Confirmed.
- **Watchdog trap (Task 4 — the load-bearing claim).** Confirmed real: `SessionWatchdogService.sweep` (`session-watchdog.service.ts:56-63`) reaps `status IN {ACTIVE, DISCONNECTED} AND lastActivityAt < now − maxIdleMs`. It keys on `lastActivityAt`, never `startedAt`. A client clock behind by > `WS_SESSION_MAX_IDLE_MS` leaking into `lastActivityAt` would let a freshly-DISCONNECTED session be reaped inside the grace window. The mandated split of `const now` is justified and necessary.
- **`endActivity` not touching `lastActivityAt` (Task 5).** Confirmed safe: COMPLETED is excluded from the watchdog's status filter (`In([ACTIVE, DISCONNECTED])`), so a client-sourced `endedAt` cannot trigger reaping.
- **Controller wiring (Task 6).** `handleActivityStart` already receives `cmd` (`module-state.grpc.controller.ts:240-289`) — `cmd.clientTimestampMs` is reachable. End dispatch at line 208 (`else if (msg.activityEnd !== undefined)`) and `handleActivityEnd` at line 301 match the plan's references; `msg.activityEnd.clientTimestampMs` is reachable. Line numbers in the plan (~208, ~305) are accurate.
- **No migration required.** `startedAt`/`endedAt`/`lastActivityAt` already exist on `ModuleSession` (`module-session.entity.ts`). The plan correctly omits a migration — no schema change.

## Minor Issues (non-blocking)

### 1. `coerceClientTs` parameter type vs. actual ts-proto output
Task 3 (and note 57) state int64 "arrives as a `Long`/string." For **this** project's ts-proto config that is inaccurate: the generator runs **without `forceLong`**, so int64 fields are emitted as `number` and decoded via `longToNumber(reader.int64())` (verified: `StateErrorEvent.timestamp: number` and `BioSample.timestamp: number` in `proto/generated/*.ts`; existing code does `Number(s.timestamp)` defensively on an already-`number` value). Consequences:
- The generated `clientTimestampMs` will be typed `number | undefined`, not `Long`.
- The proposed signature `coerceClientTs(clientTimestampMs?: number | Long | string)` would require importing `Long` from the `long` package; if not imported it is a compile error. **Recommend typing the parameter `number | undefined`.** The `Number(...)` coercion is harmless to keep as defensive hardening, but the `Long`/string rationale does not apply here.
- Edge note: `longToNumber` throws for values above `Number.MAX_SAFE_INTEGER`. Normal millisecond wall-clock values are far below this, so it is not a concern — just be aware the value is already coerced before `coerceClientTs` sees it.

### 2. Task 7 test setup needs mocks that echo the entity
The existing spec mocks return a **fixed** session regardless of input (`repo.create.mockReturnValue(session)`, `repo.save.mockResolvedValue(session)` with `makeSession()` hardcoding `startedAt = new Date()`). With those mocks, the engine's client-sourced `startedAt`/`endedAt` are discarded and the assertions "`startedAt`/`endedAt` equal the supplied instant" **cannot pass**. The implementer must switch to `mockImplementation((e) => e)` (echo the created/saved entity) for the client-timestamp cases so the field set by the engine survives into the returned object and the in-memory `ActivityState`. Worth calling out explicitly in Task 7 so the test is written correctly the first time. The `lastActivityAt`-stays-server guard case (7c) similarly needs the echo so `startedAt` reflects the client value while `lastActivityAt ≈ now`.

### 3. DTO validation is decorative (informational)
Task 4 adds `@IsOptional() @IsNumber()` to `ActivityStartDto`. Note that this DTO is never run through a `ValidationPipe` — the controller builds the object literal manually and passes it to `startActivity` (existing `activityRefId` decorators are likewise unenforced). So `coerceClientTs` is the only real guard, which the plan correctly relies on. Adding the decorators for consistency is fine; just don't assume they enforce anything at runtime.

## Positive Notes

- Correctly preserves `reserved 3` and chooses field `4` — avoids tag reuse that would corrupt wire compatibility.
- The `lastActivityAt` split is identified as mandatory and load-bearing, with the watchdog grace-window invariant called out — this is the one subtle correctness trap and the plan handles it head-on.
- Single, fixed sanity rule for `endedAt` (fall back to `now()` when absent/invalid or before `startedAt`) avoids negative durations without clamping ambiguity.
- `SESSION_EVENT` stream markers correctly kept on server `Date.now()` — not fed the client value.
- Backward-compatible (optional fields, absent → `now()`); no `proto/generated/` hand-edits; pause/resume/stop untouched. Commit plan is coherent and groups proto+regen, engine, then controller+tests.

PLAN_REVIEW_PASS
