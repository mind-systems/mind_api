# Code Review: Author `proto/bci_devices.proto` and regenerate stubs

**Plan:** `.ai-factory/plans/01-author-proto-bci-devices-proto-and-regenerate-stubs.md`
**Changed files:**
- `proto/bci_devices.proto` (new)
- `proto/generated/bci_devices.ts` (regenerated locally; `.gitignore`d — not staged)

## Scope of review
Pure proto contract change. No runtime code (modules, services, controllers, migrations, entities) is added in this milestone. The generated `.ts` stub is excluded from version control (`.gitignore:5 → /proto/generated`), so the only on-disk artifact reaching the repo is the `.proto` file itself.

## Correctness

- **Syntax / package:** `syntax = "proto3";` and `package mind;` — match every other proto in the directory (`sync.proto`, `breath_sessions.proto`, `users.proto`, etc.).
- **Imports:** `import "google/protobuf/empty.proto";` — required by the two RPCs that use `Empty`. Resolves cleanly via `protoc -I./proto` since `google/protobuf/empty.proto` ships with `protoc`; the existing `proto/generated/google/` directory confirms prior protos already use well-known types successfully.
- **`BciDevice` message** (`bci_devices.proto:14-19`):
  - Field tags `1..4` in declared order, all `string` — matches the roadmap spec verbatim.
  - `created_at`/`updated_at` typed as `string` (ISO-8601), consistent with `SyncEventDto.created_at` in `sync.proto:18` and `BreathSessionDto` per the project convention noted in `sync.proto`.
  - `id: string` matches the planned UUID PK in the next roadmap task (`AddBciDevicesTable` migration).
  - Header comment correctly forward-references `src/bci/entities/bci-device.entity.ts` (file does not exist yet — created in the next roadmap task; this is intentional, not a defect).
- **Per-RPC messages** (`bci_devices.proto:26-38`):
  - `ListBciDevicesResponse.devices = 1` (`repeated BciDevice`) — correct.
  - `RegisterBciDeviceRequest.serial = 1` — correct.
  - `DeleteBciDeviceRequest.id = 1` — correct.
  - None of them contain a `user_id` / identity field, matching the project convention (identity flows through `GrpcAuthInterceptor` metadata; verified in `sync.proto:36-39` and confirmed by the corresponding roadmap line).
- **Service definition** (`bci_devices.proto:49-53`):
  - Service name `BciDevicesService` matches the roadmap and the stub's `BCI_DEVICES_SERVICE_NAME` constant (`proto/generated/bci_devices.ts:257`).
  - Three RPCs in the spec'd order, all unary (no `stream` keyword). Signatures exactly match the roadmap: `List(google.protobuf.Empty) → ListBciDevicesResponse`, `Register(RegisterBciDeviceRequest) → BciDevice`, `Delete(DeleteBciDeviceRequest) → google.protobuf.Empty`.

## Regeneration sanity check

Ran via `npm run proto:gen` produces `proto/generated/bci_devices.ts`. Spot-checked the output:
- `protobufPackage = "mind"` (line 14) — matches.
- `BciDevicesServiceController` interface (lines 234-240) exposes `list / register / delete` with the expected request / response types and correctly returns `Promise<void>` / `void` for `delete` since the response type is `Empty`.
- `BciDevicesServiceControllerMethods()` decorator factory (lines 242-255) registers all three RPCs via `@GrpcMethod("BciDevicesService", method)`, no stream methods — consistent with the proto having no `stream` keywords.
- `BCI_DEVICES_SERVICE_NAME = "BciDevicesService"` — downstream `bci-devices.grpc.controller.ts` (future task) can reference this constant for the `@GrpcMethod` service name string.

## Risk / breakage analysis

- **Runtime impact:** None this milestone. The proto file is not yet referenced by `main.ts` `transport`/`package` options (gRPC server uses the loaded proto path list), and no controller exists to wire it in. Subsequent roadmap tasks will integrate it.
- **`.gitignore`:** `/proto/generated` is correctly ignored (`git check-ignore` confirms). The regenerated stub stays local — no risk of stale committed codegen output drifting from the source proto.
- **Cross-project propagation:** Per `CLAUDE.md` ownership rule, `mind_mcp` and `mind_mobile` will need to copy this file and regenerate when they consume the new RPCs. Out of scope for this task — explicitly deferred by the roadmap (mobile is the eventual consumer, and the milestone covers only the API-side proto authoring).
- **Field numbering / wire compat:** First version of the contract, no existing clients — renumbering / renaming is still safe at this stage.

## Style / conventions

- Comment banner pattern (`// --- Shared types ---`, `// --- Per-RPC request / response messages ---`, `// --- Service definition ---`) matches `sync.proto:5-7, 29-31, 69-77` exactly.
- The "Auth identity comes from metadata/interceptor, not the message" phrasing mirrors `sync.proto:35` ("Auth identity comes from metadata/interceptor, not the message").
- Field/message naming uses `snake_case` for proto fields and `PascalCase` for messages — consistent with the rest of the directory.

## Findings

None.

REVIEW_PASS
