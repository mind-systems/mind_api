# Plan Review: Author `proto/module_biometric_stream.proto` and regenerate stubs

## Summary

The plan is a faithful, mechanical translation of the spec in `.ai-factory/notes/03-biometric-stream-service.md` §2 ("Proto envelope") into a single proto-authoring task plus a regeneration task. Scope is correctly narrowed: only the `.proto` file and its generated stubs — no controller, engine, migration, `RealtimeModule` wiring, or `src/main.ts` `protoPath` registration (those are separate roadmap items in Phase 19 and explicitly out-of-scope for this milestone).

## Context Gates

- **ARCHITECTURE.md** — `proto/` is project-wide single source of truth (`mind_api/CLAUDE.md`, root `CLAUDE.md`). New file goes into the same directory as existing protos. No boundary violation. ✅
- **RULES.md** — No application code is written in this milestone; gRPC method signature rule (`@Payload()` + `@GrpcCurrentUser()`) does not apply to proto authoring. No `!` non-null usage, no logging. ✅
- **ROADMAP.md** — Plan corresponds 1:1 to the first un-checked bullet in Phase 19 ("Author `proto/module_biometric_stream.proto` and regenerate stubs"). Phase 17 (`@GrpcCurrentUser()` alignment of the instruction controller) and Phase 18 (`SessionEvents.REVOKED` + flush) are listed as prerequisites in note 03 and the Phase 19 intro; both are `[x]` complete. ✅

## Verification against codebase

### Files referenced
- `proto/module_instruction_stream.proto` — exists, contents match the plan's "mirror" assumption (header banners "Client → server samples", "Server → client acknowledgements", "Streaming message wrappers", "Service definition"; `StreamAck` has exactly the five fields the plan asks `BioStreamAck` to mirror — `session_id`, `received_count`, `dropped_count`, `max_samples_per_second`, `timestamp`).
- `proto/module_state.proto` — `StateErrorEvent` is declared at top level (lines 68–72) with the explicit comment "This message is top-level so module_instruction_stream.proto can import it later." Reuse in `BioStreamResponse` is sound.
- `package mind;` — matches every other proto in the directory.
- Import style `import "module_state.proto";` (not `"./module_state.proto"`) — matches the existing instruction proto and the `-I./proto` include path in `package.json`'s `proto:gen` script.

### Script
- `npm run proto:gen` resolves to `protoc -I./proto --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./proto/generated --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true ./proto/*.proto`. The plan's description of what it does is accurate.
- `--ts_proto_opt=nestJs=true,outputServices=grpc-js` will produce `ModuleBiometricStreamService` NestJS controller/client decorators in the generated file, as the plan claims.

### Spec alignment (note 03 §2 → plan Task 1)
Every field, type, number, and message structure in the plan matches the note exactly:

| Element | Note 03 | Plan | Match |
|---|---|---|---|
| `BioSample.session_id = 1` (string) | ✓ | ✓ | ✅ |
| `BioSample.timestamp = 2` (int64) | ✓ | ✓ | ✅ |
| `BioSample.sample_type = 3` (string) | ✓ | ✓ | ✅ |
| `BioSample.data = 4` (google.protobuf.Struct) | ✓ | ✓ | ✅ |
| No `module_id` field | ✓ explicit | ✓ explicit | ✅ |
| `BioSampleBatch.samples = 1` (repeated) | ✓ | ✓ | ✅ |
| `BioStreamAck` five fields | ✓ | ✓ | ✅ |
| `dropped_count` cumulative semantics documented | ✓ note 03 §5 gap | ✓ explicit | ✅ |
| `BioStreamResponse.event` oneof of `ack`/`error` | ✓ | ✓ | ✅ |
| `StateErrorEvent` reused from `module_state.proto` | ✓ | ✓ | ✅ |
| `service ModuleBiometricStreamService.StreamData` (bidi) | ✓ | ✓ | ✅ |

## Findings

### Minor: "commit generated output" wording in Task 2
Task 2's title says "Run `npm run proto:gen` and commit generated output", but `proto/generated/` is gitignored:

```
$ cat .gitignore | grep generated
/proto/generated
```

`proto/README.md` confirms: *"Output goes to `proto/generated/`, which is excluded from version control."* In practice this means only the new `proto/module_biometric_stream.proto` source file gets committed; the `.ts` artifacts under `proto/generated/` are recreated locally on each consumer's machine via `npm run proto:gen`. The task body correctly focuses on running the script and verifying outputs — the title's "commit generated output" phrasing is misleading but the body is accurate. **Non-blocking** — should be clarified to "Run `npm run proto:gen` and verify generated output" to avoid the implementer trying to `git add proto/generated/module_biometric_stream.ts`.

### Minor: no explicit guidance on `// Maps to …` comments
The existing `module_state.proto` annotates each message with `// Maps to <DTO/entity>` pointing to its TypeScript counterpart, and Phase 16's `bci_devices.proto` task asked for similar mapping comments. There is no corresponding TS type yet (controller / DTO / entity are later Phase 19 tasks), so the plan's "match the comment/section style" with the four header banners in the instruction proto is the right call. **Not a gap** — just worth being aware that `// Maps to …` annotations should be added in later phases once the matching code exists.

### No other issues
- File path `proto/module_biometric_stream.proto` — correct, matches the directory convention and the roadmap item.
- Field numbering — sequential, no reserved gaps required.
- Imports — `google/protobuf/struct.proto` is already used by `module_instruction_stream.proto` (proven path), `module_state.proto` import is already used the same way. No new path-resolution risk.
- `proto/main.ts` registration — correctly scoped out (separate roadmap bullet).
- Server-side validation, controller, engine, migration — correctly scoped out.

## Critical Issues

None.

## Positive Notes

- Plan calls out the cumulative-semantics fix in `dropped_count` (note 03 §5 gap) and tells the implementer to comment it accordingly.
- Plan explicitly forbids hand-editing `proto/generated/` and tells the implementer to fix `.proto` instead — correct discipline given `ts-proto` is the only writer.
- Plan correctly notes the `import "module_state.proto"` dependency and reasons about it ("required because `StateErrorEvent` is reused").
- Scope is tight: one new file + a script run. No accidental scope creep into controller/engine work.

PLAN_REVIEW_PASS
