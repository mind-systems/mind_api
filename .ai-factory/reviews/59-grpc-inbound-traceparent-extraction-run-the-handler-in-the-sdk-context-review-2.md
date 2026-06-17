# Code Review (Pass 2): gRPC inbound `traceparent` extraction — run the handler in the SDK context

**Reviewed:** `git diff HEAD` + `git status`. Functional change: `src/grpc/grpc-trace-context.interceptor.ts` (new), `src/app.module.ts` (global registration). Incidental: prettier reformatting of 5 unrelated files.
**Risk:** 🟢 Low.
**Verdict:** No correctness, security, or runtime bugs. The single finding from review 1 (prettier violations) is resolved. Cleared to commit.

## Change since review 1

The implementer ran `npm run format`, which:
1. Fixed the two `prettier/prettier` violations flagged in review 1 — `app.module.ts` `providers` element is now wrapped, and the interceptor's import is now multi-line. Both files are now **lint-clean** (`eslint` exit 0, no output).
2. Incidentally reformatted 5 files that had pre-existing whitespace drift: `breath-sessions.service.ts`, `breath-sessions.service.spec.ts`, `main.ts`, `meditation-poses.grpc.controller.ts`, `migrations/1780524587785-RenamePoseNameToPoseIdInMeditationNotes.ts`, `sessions/sessions.service.ts`.

The **functional code is byte-for-byte identical** to what review 1 verified — the formatting pass changed only line-wrapping. I re-read each reformatted file's diff: every hunk is pure whitespace (import collapse/expand, argument wrapping, indentation 4→2 in the migration). No logic, no SQL, no control-flow, no type changes. The migration's `ALTER TABLE … RENAME COLUMN` statements (`up`/`down`) are unchanged.

## Verification

- **Build passes** — `nest build` (tsconfig.build.json) compiles cleanly.
- **Owned files lint-clean** — `eslint src/grpc/grpc-trace-context.interceptor.ts src/app.module.ts` → exit 0, zero problems.
- **Remaining 9 eslint errors are pre-existing and unrelated** — `no-require-imports` (`main.ts:10` `DailyRotateFile = require(...)`), `no-misused-promises` (`main.ts:144-145` SIGTERM/SIGINT handlers), `no-unsafe-*` (`sessions.service.ts:81/91/92`, `breath-sessions.service.ts:256`). I confirmed via `git show HEAD:` that all these lines exist verbatim on HEAD; this diff only reformatted whitespace around them, it did not introduce them. They are out of scope for this milestone.
- **Runtime correctness (carried from review 1, re-confirmed against `observe-js` source):**
  - No-traceparent path is safe: absent metadata → `?? ''` → `extract` runs `parseTraceparent('')` → split length 1 ≠ 4 → `undefined` → `if (!ctx) return next.handle()`. No bogus/zero `trace_id` ever stamped.
  - Transport guard (`getType() !== 'rpc'`) early-outs before `switchToRpc()`, so HTTP/WS contexts are pure pass-throughs — no crash on the Express `Response.get()` shape.
  - Global `APP_INTERCEPTOR` runs outermost (before controller-scoped `GrpcAuthInterceptor`); `next.handle()` subscribed inside `runWithContext`, so unary handlers and their async continuations inherit the ALS store.
  - `runWithContext` (restore-on-exit) correctly chosen over `bindContext`; teardown `() => sub?.unsubscribe()` is idempotent.

## Observation (non-blocking)

- **Commit scope:** the commit will bundle whitespace reformatting of 5 files beyond the interceptor. That is harmless (output of the standard `npm run format`) but slightly widens the diff beyond the milestone's stated surface. If the team prefers a tightly-scoped commit, the unrelated reformats could be split out — purely a hygiene preference, not a defect.

## Conclusion

The implementation is correct, safe, and now fully formatted to project style. The streaming-handler ALS limitation remains correctly self-flagged as droppable in the plan (Task 3); for the unary path, which is what this delivers, the behavior is sound. No blockers.

REVIEW_PASS
