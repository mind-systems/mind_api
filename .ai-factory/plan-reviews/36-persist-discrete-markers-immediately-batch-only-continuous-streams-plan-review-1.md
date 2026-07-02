# Plan Review: Persist discrete markers immediately; batch only continuous streams

**Plan:** `36-persist-discrete-markers-immediately-batch-only-continuous-streams.md`
**Files Reviewed:** 1 plan + targeted source (`stream-engine.service.ts`, spec, entity, constants, `sessions.service.ts`, instruction controller, proto)
**Risk Level:** 🟡 Medium (implementation is sound; one client-trust design concern to acknowledge)

## Verdict summary

The plan is accurate, implementable, and matches the codebase. Correct file path, correct import path, correct TypeORM API usage, no migration required. It aligns exactly with the **already-committed RED tests** in `stream-engine.service.spec.ts` (`describe('immediate marker persistence')`, lines 253–304) — so `Testing: no` is the right call: the tests exist and this plan turns them green.

## Verification against committed tests (all match)

- `makeMarkerSample('paused')` = `{ timestamp: 1000, data: { dataType: 'session_event', event: 'paused' } }`. The plan's discriminator `(sample.data as { dataType?: string })?.dataType === StreamDataType.SESSION_EVENT` correctly matches it, and `create({ moduleSessionId, samples: [sample], flushedAt: new Date() })` satisfies the `objectContaining` assertion at lines 258–265. ✓
- Two-marker test (269–283): the per-push branch fires one `save` per marker → two one-element saves, in order. ✓
- `breath_phase` test (285–293): `{ data: { phase: 'exhale' } }` has no `dataType` → falls through to buffer, no immediate save. ✓
- `makeSample` string-data test (295–303): `data: 'x'` cast to `{ dataType? }` reads `undefined` (no crash) → buffered. ✓
- Saves are issued synchronously inside `push` (the `void`/`.catch` only detaches awaiting), so the non-async tests observe `repo.save` having been called. ✓

## Correctness / architecture checks (no blockers found)

- **No migration needed** — reuses the existing `session_stream_samples` entity/table and the same row shape as `doFlush`. Correct.
- **Read path is unaffected.** `SessionsService.listInstructions` (lines 413–452) orders rows by `flushedAt` but then re-sorts the flattened output by each sample's own `timestamp`. Markers carry `timestamp: Date.now()` from the activity-engine emitters, so writing them as separate immediate rows does not disturb timeline ordering.
- **Coarse `flushedAt` filter is not regressed.** Markers now get `flushedAt ≈ event time` instead of batch-flush time — strictly *more* precise for the `[from, to+PAD]` window filter, never less. No false-drops introduced.
- **Marker emitters unaffected.** All 7 `activity-engine` emitters call the mocked `streamEngine.push(...)`; the multi-session-lifecycle and activity-engine specs assert the *call*, not buffer internals, so they stay valid. The public signature/return type is preserved as required.
- **No FK risk.** `SessionStreamSample.moduleSessionId` is a plain indexed uuid column (no FK constraint), and the `STARTED` marker is pushed only after `saved` is persisted, so the immediate write never references a missing row.
- **Byte accounting stays coherent** — markers bypass the buffer, so `byteSize` simply never counts them; nothing else reads a marker-inclusive byte total.

## Critical Issues

None that block the intended (server-emitted marker) flow.

## Concern to acknowledge (non-blocking, recommend a line in the plan)

**Client-controllable discriminator bypasses the only server-side backpressure.**
The marker branch keys on `sample.data.dataType`, and `data` is a free-form proto `Struct` supplied by the client on the instruction stream (`module-instruction-stream.grpc.controller.ts:94–99`, `proto/module_instruction_stream.ts` → `data: { [key: string]: any }`). An authenticated client that sets `data.dataType = 'session_event'` on its samples will be routed to the immediate-persist branch, which by design **skips the byte-cap and `maxSessions` checks** and issues **one DB insert per sample**. Today those same samples are smoothed into one batched write per ~5s per session; the change removes that smoothing for anything carrying the marker discriminator, i.e. a write-amplification / DoS vector scoped to a single authenticated session.

The plan's stated intent is that markers only originate from the 7 server emitters, but the chosen discriminator is reachable from the client path. Recommend the implementer either:
- explicitly accept and document this (blast radius = one authenticated user's own session), or
- add a cheap guard (e.g. only treat as an immediate marker when the sample also lacks the client-only fields `moduleId`/`instructionType`, or keep markers subject to a lightweight per-session rate limit).

This is a design note, not a defect in the coded behavior — flag it so it's a conscious decision rather than an accident.

## Positive Notes

- Tight, well-scoped single-task plan with an explicit "do not touch" list (signature, emitters, entity, proto, client) that correctly protects committed assertions.
- Pins the exact fire-and-forget pattern (`void ... .catch(logger.error)`) matching the existing `lastActivityAt` update style in `doFlush` — consistent with the module's conventions and the `Logger` logging rule.
- Correctly identifies that `sample.data` is `unknown` and prescribes a narrow cast rather than a blanket `any`.

PLAN_REVIEW_PASS
