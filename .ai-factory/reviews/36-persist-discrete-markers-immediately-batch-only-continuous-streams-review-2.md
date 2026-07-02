# Code Review 2: Persist discrete markers immediately; batch only continuous streams

**Plan:** `36-persist-discrete-markers-immediately-batch-only-continuous-streams.md`
**Change under review:** `src/realtime/services/stream-engine.service.ts` (marker branch in `push`)
**Verification:** `npx jest stream-engine.service.spec.ts` → 22/22 pass. `tsc --noEmit` clean for this file (3 errors in `biometric-stream-engine.service.spec.ts` are pre-existing on HEAD, unrelated).

## What changed since review-1

The implementation was revised to address both review-1 findings:
- **Client-guard added** — the marker branch now also requires `sample.moduleId === undefined && sample.instructionType === undefined`, intended to stop a client from routing its own samples around the byte-cap by stamping `data.dataType`.
- **`lastActivityAt` update added** — the marker branch now fires the same `moduleSessionRepo.update({ id }, { lastActivityAt: now })` that `doFlush` performs, with a shared `now`. This fully resolves review-1 Finding 2 (liveness-refresh divergence). ✅

The rest is unchanged and correct: fire-and-forget one-element row, byte-cap/`maxSessions` skipped, success `PushResult` reading `totalReceived` from an existing buffer or `0`, signature/emitters/proto untouched, row shape mirrors `doFlush`. The committed tests stay green because `makeMarkerSample` pushes a bare `{ timestamp, data }` (no `moduleId`/`instructionType`), so the guard treats it as a server marker.

---

## Findings

### 1. (Medium) The new client-guard is ineffective — its premise about proto defaults is wrong, so the byte-cap/`maxSessions` bypass from review-1 is not actually closed

The guard rests on the comment's claim: *"Client-pushed samples always carry moduleId/instructionType (proto string fields, `''` when unset)."* That is false under this app's runtime gRPC configuration.

`main.ts:98-127` calls `connectMicroservice` with **no `loader` option**, so `@nestjs/microservices` invokes `@grpc/proto-loader`'s `loadSync(file, undefined)`, and the message deserializer is `cls.toObject(cls.decode(buf), {})` (`@grpc/proto-loader/build/src/index.js:77-80`). With no `defaults` key, protobufjs `toObject` uses `defaults: false`, and a proto3 scalar that was **absent on the wire** (which includes any field left at its `''` default, since proto3 does not serialize default-valued scalars) deserializes to `undefined` — not `''`.

Verified empirically against protobufjs directly:
```
toObject({}):               moduleId= undefined   ===undefined: true
toObject({defaults:true}):  moduleId= ""          ===undefined: false
```
So the runtime yields `undefined` for an unset `moduleId`/`instructionType`, exactly the value the guard treats as "server marker."

**Failure scenario:** an authenticated client sends a `StreamSample` with `data = { dataType: "session_event", ... }` and simply does *not* set `moduleId`/`instructionType` (trivial — they are optional proto3 strings). After the controller passes `msg.moduleId`/`msg.instructionType` (both `undefined`) into `push` (`module-instruction-stream.grpc.controller.ts:94-99`), the guard evaluates `undefined === undefined && undefined === undefined && dataType === SESSION_EVENT` → `true`. The sample takes the immediate-persist branch, which by design **skips the per-session byte-cap and `maxSessions` guard** and issues **one `INSERT` per sample** with no `droppedCount`. This is precisely the write-amplification / backpressure-bypass vector review-1 flagged; the added guard does not close it.

The guard does narrow the surface for *well-behaved* clients that always populate a non-empty `moduleId`/`instructionType` (those arrive defined → correctly buffered), but it provides no protection against a deliberate or buggy client that omits them. Recommend one of:
- **Make the loader premise true** — set `loader: { defaults: true }` on the gRPC transport options so unset client scalars become `''` (defined), which makes `=== undefined` a reliable server-vs-client discriminator. (Verify no other consumer relies on the current `undefined`-for-unset behavior before flipping this globally.)
- **Discriminate on a field the client cannot forge as a default** — e.g. a dedicated server-only marker flag on the internal `InstructionSample` (not part of the proto), set only by the 7 emitters, rather than inferring server-origin from the absence of client fields.
- **Or** explicitly accept the residual risk (blast radius = one authenticated user's own session) and correct the misleading comment so the next reader does not trust a guard that does not hold.

At minimum the code comment must be fixed: it asserts runtime behavior (`''` when unset) that is the opposite of what this transport produces.

---

## Non-issues verified

- **Review-1 Finding 2 (lastActivityAt) — resolved.** The marker branch now refreshes `lastActivityAt` with the same fire-and-forget pattern as `doFlush`, sharing one `now`.
- **No functional regression for legitimate traffic.** Real `breath_phase` samples never carry `data.dataType`, so they never enter the marker branch regardless of whether `moduleId`/`instructionType` are `undefined` — the guard only ever mis-fires on samples that *already* carry the `SESSION_EVENT` discriminator, which legitimate clients do not send.
- **Read/timeline ordering** — `SessionsService.listInstructions` re-sorts flattened samples by each sample's own `timestamp`; immediate one-element marker rows do not disturb ordering.
- **Type safety** — narrow `as { dataType?: string } | undefined` on `unknown` `data` reads safely for string/other payloads; `tsc` clean.
- **No migration / FK risk** — reuses the existing `session_stream_samples` table; `moduleSessionId` is a plain indexed uuid; `STARTED` is emitted only after the row is persisted.
