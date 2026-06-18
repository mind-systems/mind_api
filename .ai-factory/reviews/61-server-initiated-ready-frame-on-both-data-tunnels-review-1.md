# Code Review: Server-initiated `ready` frame on both data tunnels

**Scope reviewed:** code changes only (proto + controllers + generated stubs). Plan/note/handoff artifacts not reviewed.

## Files changed
- `proto/module_instruction_stream.proto` — added `StreamReady` message + `ready = 3` oneof arm
- `proto/module_biometric_stream.proto` — added `BioStreamReady` message + `ready = 3` oneof arm
- `proto/generated/module_instruction_stream.ts` / `module_biometric_stream.ts` — regenerated stubs
- `src/realtime/module-instruction-stream.grpc.controller.ts` — emit `ready`, removed `[probe]` lines
- `src/realtime/module-biometric-stream.grpc.controller.ts` — emit `ready`, removed `[probe]` lines

## Verification performed
- **Build:** `npm run build` — clean.
- **Lint:** `eslint` on both controllers — exit 0, no warnings (no orphaned `firstLogged`/dead imports).
- **Stub regeneration:** generated files were regenerated, not hand-edited. `StreamResponse`/`BioStreamResponse` now expose `ready?: StreamReady | undefined`. `StreamReady`/`BioStreamReady` interfaces are `{ maxSamplesPerSecond: number; timestamp: number }` — same numeric types as the existing `ack` fields, so `maxSamplesPerSecond` (a `number` getter on both engines) and `Date.now()` assign without coercion.

## Correctness analysis
- **Ordering is correct and is the whole point of the fix.** In both controllers the `ready` frame is emitted synchronously after `activeStreamRegistry.register(...)` and before `request.subscribe(...)`. There is no `await` or yield point between `register` and the `subscriber.next({ ready })` call, so nothing can interleave — `ready` is provably the first outbound frame on the response stream. `register()` only stores the subscriber; it does not itself emit, so it cannot preempt `ready`.
- **`!user` early-return path** still returns before any `register`/`ready` emit — unauthenticated streams get only the `UNAUTHENTICATED` error, unchanged.
- **No `sessionId` on `ready`** — matches the spec (no session is bound at stream open). The arm carries only `maxSamplesPerSecond` + `timestamp`.
- **Backward compatibility** — additive oneof arm; the two protos keep `ack = 1` / `error = 2` and append `ready = 3`. Old clients decode an unknown field as `notSet` and ignore it. Zero behavior change for un-upgraded clients.
- **Symmetry** — applied identically to both controllers; biometric `ready` reads from `BiometricStreamEngine.maxSamplesPerSecond`, instruction from `StreamEngine.maxSamplesPerSecond`. Both are `number` getters backed by `ConfigService`.
- **Engines / validation / ack-error untouched** — `StreamEngine.push`, `BiometricStreamEngine.pushBatch`, all `sessionId`/batch-validation guards, and ack/error branches are unchanged. The `ready` frame does not pass through `push()`, so it does not perturb `totalReceived`/`droppedCount` accounting.
- **Probe cleanup is complete** — both controllers: `[probe] subscriber entered`, `let firstLogged`, `[probe] request.subscribe() called`, and the `if (!firstLogged)` block (with `[probe] FIRST frame next()`) are all gone. The biometric `next` handler now calls `handleBatch` directly (rewritten from an arrow-expression to an equivalent block body — functionally identical).
- **Reconnect path** — on a mid-session reconnect the client opens a fresh call; the new subscriber is registered and immediately receives `ready` before the server reads any client frame, which is exactly the race the milestone closes.

## Findings
None. The implementation matches the spec and the plan precisely, builds and lints clean, and is backward compatible.

REVIEW_PASS
