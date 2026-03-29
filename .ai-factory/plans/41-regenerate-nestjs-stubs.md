# Plan: Regenerate NestJS stubs

## Context
Re-run `ts-proto` codegen from the updated `.proto` sources so `proto/generated/module_state.ts` is guaranteed free of any removed `Presence`-related symbols (`PresenceCmd`, `PresenceState`, `presence` field in `SessionRequest`). Verify the build still compiles after regeneration.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Regenerate and verify

- [x] **Task 1: Run proto codegen**
  Files: `proto/generated/*.ts`
  Run `npm run proto:gen` from the `mind_api/` root. This executes:
  ```
  protoc -I./proto \
    --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_out=./proto/generated \
    --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true \
    ./proto/*.proto
  ```
  All files under `proto/generated/` will be overwritten with output matching the current `.proto` sources.

- [x] **Task 2: Verify absence of Presence symbols**
  Files: `proto/generated/module_state.ts`
  After codegen completes, confirm that `proto/generated/module_state.ts` contains **none** of the following:
  - `PresenceCmd` (interface, encoder/decoder, or factory)
  - `PresenceState` (enum or type)
  - `presence` field inside the `SessionRequest` interface or its `oneof command` branch
  If any of these still appear, the `.proto` source was not properly cleaned in a prior milestone — stop and flag.

- [x] **Task 3: Verify TypeScript compilation**
  Files: (whole project)
  Run `npm run build` to ensure the regenerated stubs are compatible with the rest of the codebase. Fix any import or type errors that surface (none expected — the proto source already matches the current generated output).
