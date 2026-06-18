# Plan Review: Server-initiated `ready` frame on both data tunnels

**Plan:** `61-server-initiated-ready-frame-on-both-data-tunnels.md`
**Spec:** `.ai-factory/notes/48-server-initiated-stream-readiness-handshake.md`
**Risk Level:** 🟢 Low

## Verification Summary

I verified the plan against the actual codebase. Every concrete claim holds:

- **Proto source-of-truth** — both `proto/module_instruction_stream.proto` and `proto/module_biometric_stream.proto` exist and currently have exactly the `oneof event { …Ack ack = 1; StateErrorEvent error = 2; }` shape the plan describes. Adding `ready = 3` is a clean additive oneof arm. ✓
- **`npm run proto:gen` exists** in `package.json` and globs `./proto/*.proto` with `ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true`. Generated stubs land in `proto/generated/`. ✓
- **Generated oneof shape** — `StreamResponse` is generated as a flattened interface (`ack?: StreamAck | undefined; error?: StateErrorEvent | undefined;`). The new arm will surface as `ready?: StreamReady | undefined`, so `subscriber.next({ ready: {…} })` is the correct emit form. ✓
- **Field naming** — `max_samples_per_second` → `maxSamplesPerSecond` and `int64 timestamp` → `timestamp: number` (confirmed against existing `StreamAck` generation: `timestamp: number` at line 49). The plan's emit object uses exactly these names and `Date.now()` (a `number`), matching the existing `ack`/`error` emits. ✓
- **`this.streamEngine.maxSamplesPerSecond`** — public getter exists on both `StreamEngine` (stream-engine.service.ts:64) and `BiometricStreamEngine` (biometric-stream-engine.service.ts:58). Both controllers already use `this.streamEngine.maxSamplesPerSecond` in their `ack` emits. ✓
- **Controller structure** — both controllers match the plan exactly: `!user` guard → `const userId = user.sub` → probe log → `let firstLogged = false` → `register(userId, subscriber)` → probe log → `request.subscribe({...})` → `subscriber.add(teardown)`. Inserting the `ready` emit after `register` and before `request.subscribe` is structurally correct. ✓
- **Probe removal targets are exact** — all four artifacts named in Tasks 4/5 (`[probe] subscriber entered` log, `let firstLogged = false;`, `[probe] request.subscribe() called` log, and the `if (!firstLogged) {…}` block with its `[probe] FIRST frame next()` log) exist verbatim at the cited locations in both files. The biometric `next` handler will correctly reduce to a direct `this.handleBatch(userId, batch, subscriber)` call. ✓
- **No test breakage** — there are no `*.spec.ts` files for either stream controller (only `module-state` and `sync-stream` controllers and the `biometric-stream-engine` service are covered). The engine spec tests the engine, not the controller. Removing probes / changing the first emitted frame breaks no existing assertion. Consistent with `Testing: no`. ✓

## Context Gates

- **Architecture** (WARN-level, none found): The change respects the modular-monolith boundary — it touches only `src/realtime/` controllers and the project-owned `proto/`. No cross-module internals are imported. `StreamEngine`/`BiometricStreamEngine` are explicitly left untouched, preserving the "controllers are thin" rule. No issue.
- **Rules** (no violations): `RULES.md` contains no proto/probe/codegen-specific constraints that this plan crosses. Logging stays on the per-class `Logger` (probes are being *removed*, not added). The `Logging: minimal` setting is honored — no new logs introduced.
- **Roadmap** (WARN — missing linkage): This is `fix`-class work (closes a proven first-frame drop race), but I found no corresponding open milestone entry in `.ai-factory/ROADMAP.md` referencing note 48 or a "ready frame / stream readiness" task. Non-blocking, but consider adding a roadmap line so the milestone is tracked and the mandatory deploy-order note (server before mobile notes 114/115) is anchored where the next orchestrator will see it.

## Observations (non-blocking)

1. **`proto:gen` regenerates all protos, not just two files.** Task 3 names only `module_instruction_stream.ts` and `module_biometric_stream.ts`, but the script globs `./proto/*.proto`. Other generated files should come back byte-identical (no other proto changes), so any diff outside the two targets signals an unintended change worth inspecting before commit. Worth a one-line `git status` check in Task 3/6 to confirm the diff is limited to the expected files.
2. **int64 wire type on `timestamp`.** ts-proto emits `timestamp: number` here (confirmed via existing `StreamAck`), so `Date.now()` is correct on the server side. Note that downstream consumers using `@grpc/proto-loader` (per roadmap note on the biometric `Number()` cast bug) deserialize int64 as a `Long`; this is a *consumer* concern (mobile, out of scope) and does not affect the server emit. No action needed server-side.
3. **Deploy-order contract** is correctly captured in the Notes section and the spec. Worth keeping prominent in the commit message so the mobile-side rollout ordering isn't lost.

## Conclusion

The plan is technically accurate, internally consistent, and faithful to the spec. File paths, API usage, field names, and edit anchors all match the codebase. No migration is required (no schema change — pure proto/controller work). No security concerns (the readiness frame carries no session/user data; it's emitted only after the `!user` auth guard passes). The only finding is a non-blocking roadmap-linkage WARN.

PLAN_REVIEW_PASS
