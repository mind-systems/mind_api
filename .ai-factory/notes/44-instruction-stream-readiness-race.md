# Stream Cold-Start Readiness Race — Server Side

**Date:** 2026-06-16
**Source:** conversation context — cross-team investigation (mobile + api)

## Decision (2026-06-16)

Two-part fix, agreed with mobile:

1. **Open all data tunnels eagerly at connect** (mobile side) — mirror the control tunnel, which never races because it is open long before the first command flows. This closes the cold-start race for the first session after connect.
2. **Readiness ACK gate** (both sides) — a tunnel does not flush samples until the server confirms it is subscribed. This is what protects the **reconnect-mid-session** path: on re-open, buffered samples would otherwise flush immediately into a not-yet-subscribed tunnel. Eager-open alone does not cover this case; the ACK does.

Always-open tunnel cost (≈2 extra idle subscriptions per connected user) is accepted for now — no pre-optimization. Server work is the `STREAM_READY` handler below, applied to **both** the instruction and biometric controllers.

**The verification plan below is still the first step** and gates everything: if early frames are genuinely dropped before `request.subscribe()`, the ACK probe (itself a first frame) is at risk, eager-open may still race on a fast cold start, and the real foundation is server-side buffering of early frames (option B). Run the logs before building.

## Key Findings

- The first DATA frame on a freshly-opened bidi stream can be lost: it arrives before the controller calls `request.subscribe()`, because the async `GrpcAuthInterceptor` (JWT verify) runs first and the handler body only executes after auth resolves.
- **Both data streams share this exact shape** — `module-instruction-stream.grpc.controller.ts` and `module-biometric-stream.grpc.controller.ts` both call `request.subscribe()` *inside* the returned Observable, after the `!user` guard. Any fix must be applied symmetrically to both, or biometrics will keep silently dropping its first batch on every cold session.
- The **state** stream (`module-state.grpc.controller.ts` / `TrackActivity`) is **not** affected: the mobile client opens it eagerly on gRPC connect, so by the time any session command flows it has been subscribed for a while. Only the two lazily-opened data streams (opened on first sample) hit the race.
- Mobile note `101` proposes a client-side `STREAM_READY` probe/ACK handshake. It is directionally correct and maps cleanly onto the current controller, **but its causal story is internally contradictory** (see below) and must be verified empirically before either side builds it.

## Details

### Mechanism (confirmed against code)

`module-instruction-stream.grpc.controller.ts:39-58`:

```ts
streamData(@Payload() request: Observable<StreamSample>, @GrpcCurrentUser() user) {
  return new Observable<StreamResponse>((subscriber) => {
    if (!user) { subscriber.error(UNAUTHENTICATED); return; }
    this.activeStreamRegistry.register(userId, subscriber);
    const sub = request.subscribe({ next: ... });   // ← only here does the server start reading
    ...
  });
}
```

`@UseInterceptors(GrpcAuthInterceptor)` (line 26) wraps the handler, so `streamData` is invoked only after async JWT verification completes. Any client DATA frame that arrives during that window is at risk depending on how the NestJS gRPC adapter buffers the incoming `request` observable.

The biometric controller is structurally identical: `module-biometric-stream.grpc.controller.ts:39-63`, same `request.subscribe()` inside the post-auth Observable.

The first guard inside `next` is `if (!msg.sessionId)` → returns `INVALID_ARGUMENT` (instruction controller line 61). This matters for option A: the probe carries an empty `sessionId`, so the `STREAM_READY` handler must run **before** this guard or the probe is rejected.

### The contradiction in note 101 (must resolve before building)

Note 101 says the root cause is: *"the first frame arrives before subscribe → the Subject has no subscriber → the frame is dropped."* But the proposed fix sends a `stream_ready` probe **as the first frame** and waits for its ACK. If "first frame before subscribe is dropped" is literally true, the probe is dropped the same way → no ACK → the client buffer never flushes → permanent deadlock.

Two clean models, neither explains both observations:
- **Frames before subscribe are dropped** → original `rest` lost ✓, but probe also lost → fix deadlocks ✗.
- **Frames before subscribe are buffered** (Node Readable in paused mode delivers them in order after subscribe) → probe works ✓, but then original `rest` would also have been delivered → bug misdiagnosed ✗.

This unresolved gap is the most likely reason note 101 records "three previous implementation attempts failed." The precise loss mechanism inside the NestJS gRPC adapter is not yet pinned down.

### Verification plan (do this first — ~15 min, no code change)

Enable debug logging on both data controllers and run one cold breath session (fresh app launch, first Play). Watch the **instruction** controller for the first frame:

- If a single first frame on a cold stream **reliably reaches** the `next` handler → frames are buffered, not dropped. Probe/ACK is sound; proceed with option A.
- If the first frame **does not reach** `next` → frames are genuinely dropped before subscribe. Probe/ACK would deadlock; the real fix is server-side (option B).

Concretely, log at the top of `next` (sessionId, instructionType) and log the moment `request.subscribe()` is called, so the ordering of "frame received" vs "subscribed" is visible.

### Option A — client probe/ACK (note 101)

Add `STREAM_READY` to `stream-data-types.ts` and handle it as the **absolute first** check in the `next` handler (before `!msg.sessionId`):

```ts
if (msg.instructionType === StreamDataType.STREAM_READY) {
  subscriber.next({ ack: { sessionId: msg.sessionId, receivedCount: 0, droppedCount: 0,
    maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond, timestamp: Date.now() } });
  return;
}
```

Mobile gates its buffer flush on receiving this ACK. **Deploy order is mandatory: server first, then mobile.** Mobile-first means the probe gets `INVALID_ARGUMENT`, the client never sets `isStreamReady`, and all instructions stay buffered forever. Apply the same handler to the biometric controller if biometrics adopts the same gate.

Cost: a new message type, paired changes in both repos, and a hard deploy-ordering constraint.

### Option B — server-side, don't lose early frames

If verification shows frames are dropped before subscribe, fixing it server-side is localized and needs **no mobile change, no new message type, no deploy ordering**. Approaches to evaluate:
- Buffer/replay the incoming `request` so no frame is lost between call-accept and `request.subscribe()` (e.g. wrap with a replay/buffering operator, or ensure the duplex stays paused until subscribe).
- Whether this is fixable in the controller depends on where the loss happens: if the NestJS adapter has already dropped frames into a plain Subject before `streamData` runs, the controller cannot recover them and the fix must live at the adapter/transport level — in which case option A becomes the pragmatic choice.

This is the deciding question and the verification plan answers it directly.

## Open Questions

- Where exactly does the NestJS gRPC adapter wire the incoming `request` observable — plain Subject (lossy) or buffered? This determines A vs B.
- After a mid-session disconnect/reconnect, does the same race re-occur on stream re-open? (Mobile note 101 flags this as untested.)
- If biometrics keeps its current fire-and-forget model (no ACK consumed), losing the first batch is far less costly than losing the one-shot `rest` instruction — is a readiness gate even warranted there, or only on instructions?
