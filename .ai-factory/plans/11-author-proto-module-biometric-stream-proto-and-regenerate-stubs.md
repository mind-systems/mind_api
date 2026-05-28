# Plan: Author `proto/module_biometric_stream.proto` and regenerate stubs

## Context
Introduce the gRPC contract for the upcoming `ModuleBiometricStreamService` — a parallel biometric sample stream alongside the existing instruction stream. Output is a new `.proto` file and its regenerated TypeScript stubs; no runtime wiring is added in this milestone.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Author proto

- [x] **Task 1: Create `proto/module_biometric_stream.proto`**
  Files: `proto/module_biometric_stream.proto`
  Author a new proto file in `proto/` mirroring the structure of `proto/module_instruction_stream.proto`. Required content:
  - `syntax = "proto3";` and `package mind;`
  - Imports: `import "google/protobuf/struct.proto";` and `import "module_state.proto";` (the latter is required because `StateErrorEvent` is reused in `BioStreamResponse`).
  - Message `BioSample` with fields exactly:
    - `string session_id = 1;`
    - `int64 timestamp = 2;` (client unix-ms at sample production time)
    - `string sample_type = 3;` (free string discriminator, e.g. `"cardio"`, `"emotions"`, `"nfb"`)
    - `google.protobuf.Struct data = 4;`
    - **No `module_id` field** — biometric data is not module-shaped; the producing module is implied by `module_sessions.activityType`.
  - Message `BioSampleBatch` with `repeated BioSample samples = 1;`.
  - Message `BioStreamAck` — five-field mirror of `StreamAck`:
    - `string session_id = 1;`
    - `int64 received_count = 2;` (cumulative across the bidi connection)
    - `int64 dropped_count = 3;` (semantically cumulative — comment must say so, fixing the gap noted in `notes/03-biometric-stream-service.md` §5)
    - `int32 max_samples_per_second = 4;`
    - `int64 timestamp = 5;`
  - Message `BioStreamResponse` with `oneof event { BioStreamAck ack = 1; StateErrorEvent error = 2; }`.
  - Service:
    ```
    service ModuleBiometricStreamService {
      rpc StreamData(stream BioSampleBatch) returns (stream BioStreamResponse);
    }
    ```
  Match comment/section style of `module_instruction_stream.proto` (header banners for Client→server, Server→client, Streaming wrappers, Service definition). Document the cumulative semantics of `received_count` / `dropped_count` and that auth identity comes from metadata/interceptor, not the message.

### Phase 2: Regenerate stubs

- [x] **Task 2: Run `npm run proto:gen` and commit generated output** (depends on Task 1)
  Files: `proto/generated/module_biometric_stream.ts` (new, generated)
  From `mind_api/`, execute `npm run proto:gen`. This invokes `protoc` with `ts_proto` over all `proto/*.proto` files and writes outputs into `proto/generated/`. Verify that:
  - `proto/generated/module_biometric_stream.ts` is created.
  - Existing files under `proto/generated/` (e.g. `module_instruction_stream.ts`, `module_state.ts`) are byte-stable or only changed by deterministic regeneration — no spurious diffs.
  - The generated file exports `ModuleBiometricStreamService` controller/client decorators (NestJS + grpc-js, per `ts_proto_opt`).
  Do **not** hand-edit anything under `proto/generated/`. If regeneration produces unexpected diffs, fix the source `.proto` rather than the generated file.

<!-- orchestrator-sessions
planner: e4a06634-ed3f-42ad-a95b-ecb61de4e912
elapsed: 388
implementer: 36d8d93b-192c-441a-a578-1db7b5b4339f
-->
