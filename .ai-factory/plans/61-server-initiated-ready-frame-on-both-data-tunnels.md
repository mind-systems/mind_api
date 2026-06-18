# Plan: Server-initiated `ready` frame on both data tunnels

## Context
Emit a server→client `ready` envelope as the first outbound frame the instant each data-tunnel controller subscribes, so the client can gate its sends until the server is provably listening — closing the first-frame drop race on both cold-start and reconnect. Spec: `.ai-factory/notes/48-server-initiated-stream-readiness-handshake.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Add `StreamReady` arm to the instruction envelope**
  Files: `proto/module_instruction_stream.proto`
  In the "Streaming message wrappers" section, add a new message:
  ```proto
  // StreamReady is the server's first outbound frame, emitted the instant the
  // controller subscribes — before any client sample is read. It signals the
  // client that the server is listening and may start sending.
  // max_samples_per_second mirrors StreamAck so the client learns the rate
  // limit before its first send.
  // timestamp is int64 Unix millis when the ready frame was produced.
  message StreamReady {
    int32 max_samples_per_second = 1;
    int64 timestamp = 2;
  }
  ```
  Add a third oneof arm to `StreamResponse.event`: `StreamReady ready = 3;` (keep `ack = 1`, `error = 2` unchanged). Additive oneof arm — old clients see `whichEvent() → notSet` and ignore it.

- [x] **Task 2: Add `BioStreamReady` arm to the biometric envelope** (depends on Task 1)
  Files: `proto/module_biometric_stream.proto`
  Symmetrically, add a new message:
  ```proto
  // BioStreamReady is the server's first outbound frame, emitted the instant the
  // controller subscribes — before any client batch is read. Mirrors StreamReady
  // from module_instruction_stream.proto.
  message BioStreamReady {
    int32 max_samples_per_second = 1;
    int64 timestamp = 2;
  }
  ```
  Add a third oneof arm to `BioStreamResponse.event`: `BioStreamReady ready = 3;` (keep `ack = 1`, `error = 2` unchanged).

- [x] **Task 3: Regenerate gRPC stubs** (depends on Task 2)
  Files: `proto/generated/module_instruction_stream.ts`, `proto/generated/module_biometric_stream.ts`
  Run `npm run proto:gen`. Confirm the generated `StreamResponse` / `BioStreamResponse` types now expose the `ready` field and that `StreamReady` / `BioStreamReady` types are emitted. Do not hand-edit generated files. Proto stays single-source in `mind_api/proto/`; mobile copies + regenerates as its own task.

### Phase 2: Controller emit + cleanup

- [x] **Task 4: Emit `ready` and remove probes in the instruction controller** (depends on Task 3)
  Files: `src/realtime/module-instruction-stream.grpc.controller.ts`
  Inside the returned `new Observable((subscriber) => {…})`, after the `!user` guard and `this.activeStreamRegistry.register(userId, subscriber)` and **before** `request.subscribe(...)`, emit the readiness frame as the first outbound message:
  ```ts
  subscriber.next({
    ready: {
      maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
      timestamp: Date.now(),
    },
  });
  ```
  No `sessionId` on `ready` (no session is bound at stream open). In the same edit, remove all note-44 `[probe]` throwaways: the `[probe] subscriber entered` log, the `let firstLogged = false;` declaration, the `[probe] request.subscribe() called` log, and the entire `if (!firstLogged) { … }` block inside `next` (including its `[probe] FIRST frame next()` log). Leave `register` → `request.subscribe()` → `subscriber.add(teardown)`, all validation/ack/error branches, and `StreamEngine` untouched.

- [x] **Task 5: Emit `ready` and remove probes in the biometric controller** (depends on Task 3)
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  Same change symmetrically: after `this.activeStreamRegistry.register(userId, subscriber)` and **before** `request.subscribe(...)`, emit:
  ```ts
  subscriber.next({
    ready: {
      maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
      timestamp: Date.now(),
    },
  });
  ```
  Remove the `[probe] subscriber entered` log, `let firstLogged = false;`, the `[probe] request.subscribe() called` log, and the `if (!firstLogged) { … }` block (with its `[probe] FIRST frame next()` log) from the `next` handler — the handler should call `this.handleBatch(userId, batch, subscriber)` directly. Do not touch `handleBatch`, the batch-validation guards, ack/error semantics, or `BiometricStreamEngine`.

### Phase 3: Build verification

- [x] **Task 6: Compile and lint** (depends on Task 4, Task 5)
  Files: —
  Run `npm run build` and `npm run lint` to confirm the new oneof arm types resolve and the probe removals leave no unused variables (e.g. `firstLogged`) or dead imports. Fix any type/lint fallout.

## Commit Plan
- **Commit 1** (after tasks 1-3): "Add ready arm to both data-tunnel stream envelopes"
- **Commit 2** (after tasks 4-6): "Emit server-initiated ready frame and remove note-44 probes"

## Notes
- **Deploy order is a contract:** this server change must ship before the mobile readiness-gate tasks (mobile notes 114/115). A mobile client gating on `ready` against an old server would buffer forever.
- Biometric `ready` is emitted here for contract completeness even if the mobile biometric gate lands later — emitting it early is harmless (old/un-gated clients ignore the unknown oneof arm).
