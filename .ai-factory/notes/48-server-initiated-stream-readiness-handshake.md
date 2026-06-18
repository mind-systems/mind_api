# Server-initiated stream readiness handshake (data tunnels)

**Date:** 2026-06-18
**Source:** conversation context — note 44 verified empirically (logs + DB)

## Key Findings

- **Root cause proven, not theorized.** A breath session (`moduleSessionId=151181ba`) was reproduced end-to-end with `[probe]` logs on both repos and a DB read of `session_stream_samples`. The first instruction frame (`rest`) was emitted by the client at 17:25:02, but the server's `[probe] FIRST frame next()` fired only at 17:25:17 (the *second* phase, `inhale`). The DB holds **no `rest` row** — only `inhale/exhale/inhale` + three server-injected lifecycle events. `StreamEngine.totalReceived` reconciles exactly: server-injected `session_started`=#1, inhale=#2, exhale=#3, inhale=#4 — `rest` never called `push()`, so it never reached `next()`.
- **Mechanism confirmed:** the first client→server DATA frame on a freshly-opened bidi stream is dropped. `streamData` is wrapped by `@UseInterceptors(GrpcAuthInterceptor)` (async JWT verify), so `request.subscribe()` runs only after auth resolves; any inbound frame the NestJS gRPC adapter delivers before that lands in a Subject with no subscriber and is lost. The controller cannot recover it (loss is inside the adapter, before `streamData` runs) — so **server-side buffering (note 44 Option B) is not feasible in the controller**.
- **Eager-open (note 44 / mobile note 101) does NOT solve it.** Opening the tunnel at connect only protects the *first* open; on a **reconnect mid-session** the client re-opens and flushes its backlog into a fresh stream whose handler hasn't subscribed yet — the exact same drop. Eager-open is dropped from the fix.
- **A client→server probe as the first frame would deadlock** — it is dropped exactly like `rest` (now proven), so its ACK never returns. The readiness signal must travel **server→client**, the direction that does *not* race: the client subscribes to the response stream synchronously when it opens the call, so it is always listening before the server's post-auth handler emits anything.
- **The fix is a server-initiated readiness frame.** The instant the controller body runs (handler subscribed), the server emits a `ready` envelope as its first outbound frame on both data tunnels. The client gates all outgoing samples until it sees `ready`. This is open-agnostic — cold-start and reconnect are handled identically.

## Details

### Proto change (source of truth — `mind_api/proto/`)

Both stream protos use a server→client envelope `oneof event { …Ack ack = 1; StateErrorEvent error = 2; }`.

- `proto/module_instruction_stream.proto`: add `message StreamReady { int32 max_samples_per_second = 1; int64 timestamp = 2; }` and a third oneof arm `StreamReady ready = 3;` in `StreamResponse.event`.
- `proto/module_biometric_stream.proto`: add `message BioStreamReady { int32 max_samples_per_second = 1; int64 timestamp = 2; }` and `BioStreamReady ready = 3;` in `BioStreamResponse.event`.
- Regenerate: `npm run proto:gen` (stubs land in `proto/generated/`). Backward compatible — existing clients ignore an unknown oneof arm (`whichEvent()` → `notSet`).

Carrying `max_samples_per_second` in `ready` lets the client learn the rate limit before its first send (today it learns it only from the first `ack`).

### Server emit (both controllers)

`src/realtime/module-instruction-stream.grpc.controller.ts` and `src/realtime/module-biometric-stream.grpc.controller.ts`, inside the returned `new Observable((subscriber) => {…})`, after the `!user` guard and `activeStreamRegistry.register(...)`, **before** `request.subscribe()`:

```ts
subscriber.next({ ready: { maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond, timestamp: Date.now() } });
```

This is the first outbound frame. It is session-agnostic (no session bound at stream open) — do not put a `sessionId` on it. The existing `register` → `request.subscribe()` → `subscriber.add(teardown)` flow is unchanged otherwise.

### Cleanup

Remove the throwaway `[probe]` lines (note-44 verification) from both controllers in the same edit — `subscriber entered`, `request.subscribe() called`, `firstLogged`/`FIRST frame next()`.

### Guards

- Apply symmetrically to **both** controllers — instruction and biometric share the exact race.
- ZERO behavior change for un-upgraded clients (additive oneof arm; old clients ignore `ready`).
- Do not touch `StreamEngine`/`BiometricStreamEngine`, the `!msg.sessionId`/batch-validation guards, or `ack`/`error` semantics.
- **Deploy order is mandatory: server (this task) before the mobile readiness-gate tasks.** A mobile client that gates on `ready` against an old server would buffer forever — the mobile side ships a fallback timeout as a net, but server-first is the contract.
- Proto edits live only in `mind_api/proto/`; mobile copies + regenerates (its own tasks).

### Verify

Reproduce a cold breath session; confirm the client receives `ready` immediately on stream open and the `rest` row now appears in `session_stream_samples` for the session (query by `moduleSessionId`). Then force a mid-session reconnect (kill/restore transport) and confirm no instruction phase is missing across the reconnect.

## Open Questions

- None blocking. Biometric `ready` is emitted by this task for contract completeness even though the mobile biometric gate may land later; emitting it early is harmless (the mobile ignores it until it adopts the gate).
