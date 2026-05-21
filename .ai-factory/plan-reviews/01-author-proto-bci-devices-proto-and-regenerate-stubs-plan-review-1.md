# Plan Review: Author `proto/bci_devices.proto` and regenerate stubs

**Plan:** `.ai-factory/plans/01-author-proto-bci-devices-proto-and-regenerate-stubs.md`
**Risk Level:** 🟢 Low

## Scope

The plan covers only Phase 16's first roadmap task — authoring `proto/bci_devices.proto` and regenerating the ts-proto stub. Downstream tasks (migration, entity, service, controller) are intentionally out of scope and tracked separately in `ROADMAP.md`. Scope boundary is appropriate.

## Context Gates

- **ARCHITECTURE / modular monolith:** N/A — proto contract layer; no module wiring in this step.
- **RULES.md:** No applicable rule is violated. The `@Payload()` rule (RULES.md) applies to gRPC controller methods, not `.proto` definitions, so it does not apply to this task. The "no `user_id` in request messages" guidance in the plan correctly mirrors the project's convention (identity flows via `GrpcAuthInterceptor` metadata, same as `sync.proto`, `breath_sessions.proto`, `users.proto`).
- **ROADMAP.md:** Plan content matches the Phase 16 first bullet verbatim (field shape, RPC signatures, `google.protobuf.Empty` import, no identity field in requests, regeneration via `npm run proto:gen`). Aligned.

## Correctness checks

- **Reference proto:** `proto/sync.proto` exists and uses the exact comment banner style (`// Shared types`, `// Per-RPC request / response messages`, `// Service definition`) referenced by the plan. Modeling after it is appropriate.
- **Field types:**
  - `id: string` — matches the planned UUID PK for the `bci_devices` table (next roadmap task).
  - `serial: string` — correct.
  - `created_at`/`updated_at: string` (ISO-8601) — matches `SyncEventDto.created_at` convention in `sync.proto`. Plan correctly calls out the mapping comment.
- **RPC signatures:** `List(Empty) → ListBciDevicesResponse`, `Register(RegisterBciDeviceRequest) → BciDevice`, `Delete(DeleteBciDeviceRequest) → Empty` — all unary, consistent with the roadmap and project convention. No `stream` keyword required.
- **Identity handling:** Correctly excluded from messages. `GrpcAuthInterceptor` (referenced in the roadmap) injects `user` via metadata; this is the established pattern.
- **`google.protobuf.Empty` import:** Required by `Empty` usage in `List` and `Delete`. Correctly specified.
- **Package name:** `package mind;` — matches every other `.proto` in the directory.

## Codegen step

- `npm run proto:gen` is the documented entrypoint (`package.json` and `proto/README.md` both confirm). The script globs `./proto/*.proto`, so the new file will be picked up automatically without script edits.
- ts-proto preserves snake_case in the output filename (verified by existing `module_instruction_stream.ts`, `module_state.ts` in `proto/generated/`), so the expected output `proto/generated/bci_devices.ts` is correct.
- `proto/generated/` is `.gitignore`d (`/proto/generated`). Plan correctly notes this and instructs against hand-editing. The regeneration step is local-verification only — there is no artifact to commit from Task 2.

## Missing / weak points

- **None critical.** The plan is tightly scoped, internally consistent, accurate about file paths, conventions, and tooling.
- **Minor:** Task 2 could explicitly note that `protoc` must be installed on the developer machine (per `proto/README.md` — `protoc ≥ 3.21`). This is a one-time dev-environment prerequisite, not a plan defect, but worth being aware of if the implementer is on a fresh setup.

## Positive notes

- Plan explicitly anchors each design decision to a reference file (`sync.proto`, `bci-device.entity.ts`, `SyncEventDto`) — easy to validate.
- The "Auth identity comes from metadata/interceptor" comment instruction is correctly propagated from the roadmap and matches the existing convention.
- Settings block (`Testing: no`, `Logging: minimal`, `Docs: no`) is appropriate for a pure contract authoring task.
- Dependency between Task 1 and Task 2 is correctly declared.

PLAN_REVIEW_PASS
