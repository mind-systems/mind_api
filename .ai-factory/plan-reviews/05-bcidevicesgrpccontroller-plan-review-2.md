# Plan Review #2: `05-bcidevicesgrpccontroller.md`

**Risk Level:** 🟢 Low — second iteration addresses all concerns from review #1 and the plan now matches the actual state of the codebase.

## Context Gates

- **ARCHITECTURE.md** — Modular monolith respected: `BciDevicesGrpcController` lives in `src/bci/`, mapper is exported from the shared `src/grpc/grpc-mappers.ts` boundary, and no cross-module `@InjectRepository` is introduced. PASS.
- **RULES.md** — The `@Payload()` requirement when combined with `@GrpcCurrentUser()` is explicitly enforced in Tasks 2/3/4 and the rationale references RULES.md directly. No non-null assertions. No PII/sensitive logging (logging setting is "minimal"). PASS.
- **ROADMAP.md** — Milestone alignment is correct: this is the controller wire-up for Phase 16's BCI device flow, depending on milestones 1–4 (proto, migration, entity/module, service). PASS.

## Verification of Review #1 Concerns

All three findings from review #1 have been resolved:

1. **Task 5 false premise (import paths already correct)** — fixed. The new Task 5 verification step explicitly notes: "the existing stub at `src/bci/bci-devices.grpc.controller.ts` already uses relative imports (`../grpc/grpc-exception.filter`, `../grpc/grpc-auth.interceptor`) consistent with `src/realtime/sync-stream.grpc.controller.ts` — no normalization needed." ✅
2. **Mapper location diverged from project convention** — fixed. Task 1 now places `toProtoBciDevice` in `src/grpc/grpc-mappers.ts` alongside `toProtoUserDto` / `toProtoBreathSessionDto`, matching the central-mappers convention. The controller imports it. ✅
3. **Shorthand `import type` bullet** — fixed. The bullet for `JwtPayload` now reads `import type { JwtPayload } from '../users/interfaces/auth.interface';` with an explicit note not to shorthand to `import { type JwtPayload }`. ✅

## Findings

### Critical Issues
None.

### Issues
None.

### Notes (non-blocking, verified)

- **Import target paths** — verified against the filesystem:
  - `../../proto/generated/bci_devices` exists and exports `BciDevice`, `ListBciDevicesResponse`, `RegisterBciDeviceRequest`, `DeleteBciDeviceRequest`. ✅
  - `../../proto/generated/google/protobuf/empty` exists. ✅
  - `../grpc/decorators/grpc-current-user.decorator` exists and returns `JwtPayload | null`. ✅
  - `../users/interfaces/auth.interface` exports `JwtPayload` with `sub: string`. ✅
  - `../grpc/grpc-mappers` is the established central-mappers file. ✅
- **Mapper-file imports** — the new `import type { BciDevice } from '../bci/entities/bci-device.entity'` and `import type { BciDevice as BciDeviceProto } from '../../proto/generated/bci_devices'` correctly disambiguate the entity-vs-proto symbol collision and use `import type` to match the surrounding style (lines 1, 2, 8-12 of `grpc-mappers.ts`). ✅
- **Service contracts** — `BciDeviceService.listForUser(userId)`, `register(userId, serial)`, `delete(userId, id)` match the plan's controller call sites (`src/bci/bci-device.service.ts:15–66`). Errors raised by the service (`NOT_FOUND`, `PERMISSION_DENIED`) use `RpcException` and are intentionally not re-handled in the controller — correct. ✅
- **Empty response** — proto `Empty` is the `{}` shape; `return {}` for the `delete` RPC is correct and matches the proto wire serializer (`responseSerialize: (value: Empty)`). The plan's `Promise<Empty>` return type is more specific than the generated controller interface's `void | Promise<void>` and is compatible. ✅
- **Date → ISO-8601** — mapper uses `entity.createdAt.toISOString()` / `entity.updatedAt.toISOString()`, matching the precedent in `toProtoBreathSessionDto` (lines 99–101) and `SyncEventDto`. ✅
- **`@GrpcCurrentUser()` + `@Payload()` pairing** — present on every RPC; defense-in-depth `if (!user)` guard raising `UNAUTHENTICATED` matches the sync-stream precedent. ✅
- **DTO validation** — correctly noted that `RegisterBciDeviceDto` is intentionally not used in the gRPC controller (the generated proto type is the wire shape). ✅
- **Commit plan** — single commit covering tasks 1–5 is appropriate now that the verification step changes no files. ✅

## Positive Notes

- The plan iterates cleanly on review #1 feedback rather than papering over it — Task 1's rationale is now factually accurate ("`src/grpc/grpc-mappers.ts` is the central, project-wide home"), and the false "normalize imports" task has been replaced with a build/lint verification that correctly notes no normalization is needed.
- Symbol collision (`BciDevice` entity vs `BciDevice` proto) is resolved up front by aliasing to `BciDeviceProto` in both the mapper file and the controller — preventing a likely compile error from being discovered late.
- Every controller import is enumerated with the exact syntax to use, including the explicit `import type { JwtPayload }` form, leaving no ambiguity for the implementer.
- Each task explicitly states its dependency on the previous one (Task 2 depends on Task 1, etc.), making the implementation order unambiguous.

PLAN_REVIEW_PASS
