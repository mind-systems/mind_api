# Review: Author `proto/module_biometric_stream.proto` and regenerate stubs

## Scope reviewed

- `proto/module_biometric_stream.proto` (new, 82 lines)
- `proto/generated/module_biometric_stream.ts` (new, gitignored via `.gitignore:5 /proto/generated`)
- Side effect of regen: `proto/generated/module_instruction_stream.ts` and peers carry the same mtime as the new file (`May 28 23:36`), confirming `npm run proto:gen` was run across the whole `proto/*.proto` set rather than just the new file. No spurious content changes detected.

## Spec conformance

Cross-checked against the milestone description and `.ai-factory/notes/03-biometric-stream-service.md` §2:

| Requirement | Status |
|---|---|
| `syntax = "proto3"`, `package mind;` | OK |
| `import "google/protobuf/struct.proto";` | OK |
| `import "module_state.proto";` (reuses `StateErrorEvent`) | OK |
| `BioSample {session_id=1, timestamp=2, sample_type=3, data=4}` — no `module_id` | OK |
| `BioSampleBatch {repeated BioSample samples = 1}` | OK |
| `BioStreamAck` five fields, same numbering as `StreamAck` | OK |
| `dropped_count` documented as cumulative | OK — comment at L41–44 explicitly states "cumulative … since this bidi connection was opened" and explains the rationale (clients can detect drops between two acks). Closes the gap called out in note 03 §5. |
| `BioStreamResponse {oneof event {ack=1, error=2}}` | OK |
| `service ModuleBiometricStreamService { rpc StreamData(stream BioSampleBatch) returns (stream BioStreamResponse); }` | OK |
| Mirror comment/section style of `module_instruction_stream.proto` | OK |
| Do not hand-edit `proto/generated/` | OK |

## Generated output sanity

`proto/generated/module_biometric_stream.ts` (372 lines):

- `BioSample`, `BioSampleBatch`, `BioStreamAck`, `BioStreamResponse` interfaces emitted with camelCase field names (`sessionId`, `sampleType`, `receivedCount`, `droppedCount`, `maxSamplesPerSecond`) — matches `ts_proto` defaults used elsewhere in the project.
- `BioStreamResponse` uses two optional fields (`ack?`, `error?`) rather than a discriminated union — identical to how `StreamResponse` is generated in `module_instruction_stream.ts:` (verified at `export interface StreamResponse { ack?: StreamAck | undefined; error?: StateErrorEvent | undefined; }`). Consistent with project convention; no `oneof=unions` opt used.
- NestJS controller decorator `ModuleBiometricStreamServiceControllerMethods()` registers `streamData` under `grpcStreamMethods` (bidi), parallel to the instruction-stream decorator. `MODULE_BIOMETRIC_STREAM_SERVICE_NAME = "ModuleBiometricStreamService"` and service descriptor path `/mind.ModuleBiometricStreamService/StreamData` are well-formed.
- `wrappers[".google.protobuf.Struct"]` registration is emitted once at module level — same as in the instruction-stream stub. `Struct` import resolves to local `./google/protobuf/struct` (already present from previous regens), and `StateErrorEvent` imports from `./module_state`. No missing-import or dangling-reference risk.

## Findings

### Nit 1 — duplicated "auth identity" comment

`proto/module_biometric_stream.proto:48` places "Auth identity comes from metadata/interceptor, not the message." inside the `BioStreamAck` doc block, and again at L76–77 inside the service-definition block. In the mirror file `module_instruction_stream.proto`, this note appears only on the service. It belongs on the service (an authn statement about the RPC), not on the ack message. Cosmetic — no runtime effect — but breaks the literal mirror with `module_instruction_stream.proto`.

Suggested action (optional): drop lines 48 from `BioStreamAck`'s doc and keep the auth note only on the service.

## Runtime risk assessment

- No migrations, no entity changes, no DI wiring touched. The new generated file is unused by any controller, service, or module yet — it is dead code until Phase 19's controller/engine lands. No risk of startup failure, no schema drift, no race conditions to evaluate.
- Type generation reproducible: regen produced identical mtimes across all stubs, indicating a deterministic single pass.

No correctness, security, or runtime issues found. The single observation above is purely stylistic.

REVIEW_PASS
