# Code Review: `05-bcidevicesgrpccontroller`

**Risk Level:** 🟢 Low — implementation matches the plan exactly; no bugs, security issues, or correctness problems identified.

## Scope of changes

`git status` / `git diff HEAD` shows two source files modified:

- `src/bci/bci-devices.grpc.controller.ts` — three RPCs added (`list`, `register`, `delete`) plus their imports.
- `src/grpc/grpc-mappers.ts` — new `toProtoBciDevice` exported mapper, plus two `import type` lines.

Plan / plan-review markdown files (`.ai-factory/...`) are documentation-only and out of scope for code review.

## Findings

### Critical Issues
None.

### Issues
None.

### Notes (non-blocking, verified)

- **RPC method naming** — `@GrpcMethod('BciDevicesService', 'list' | 'register' | 'delete')` uses the lowerCamelCase method name. The generated proto `BciDevicesServiceControllerMethods()` helper (in `proto/generated/bci_devices.ts:242–255`) registers the same lowercase forms and NestJS normalizes to the wire-format `/mind.BciDevicesService/List|Register|Delete`. Matches the sync-stream precedent (`@GrpcMethod('SyncService', 'watchChanges')`). ✅
- **`@Payload()` + `@GrpcCurrentUser()` pairing** — every RPC decorates both parameters. Without `@Payload()`, NestJS would put `undefined` in the request slot (the bug `.ai-factory/RULES.md` calls out explicitly). Verified all three RPCs comply. ✅
- **`if (!user)` defense-in-depth** — `GrpcAuthInterceptor` (read in full at `src/grpc/grpc-auth.interceptor.ts`) already throws `UNAUTHENTICATED` for missing/invalid tokens unless `@GrpcOptionalAuth()` is applied. None of the BCI RPCs use optional auth, so the inline check is unreachable in practice but harmless and matches the sync-stream precedent. ✅
- **Import paths resolve** — `'../../proto/generated/bci_devices'` exists and exports `BciDevice`, `ListBciDevicesResponse`, `RegisterBciDeviceRequest`, `DeleteBciDeviceRequest`. `'../../proto/generated/google/protobuf/empty'` exists (confirmed via filesystem listing). `'../grpc/grpc-mappers'`, `'../grpc/decorators/grpc-current-user.decorator'`, `'../users/interfaces/auth.interface'` all valid. ✅
- **Symbol-collision aliasing** — `BciDevice as BciDeviceProto` correctly disambiguates the proto interface from the TypeORM entity in both `grpc-mappers.ts` (mapper signature) and `bci-devices.grpc.controller.ts` (`register` return type). ✅
- **Mapper safety** — `entity.createdAt.toISOString()` / `entity.updatedAt.toISOString()` is safe: the `@CreateDateColumn` and `@UpdateDateColumn` on the entity are always populated by Postgres `now()` defaults (per the migration), and the service paths that call the mapper (`listForUser` → `find`, `register` → `findOneByOrFail` or `save`) all return fully-loaded rows. No null/undefined risk. ✅
- **`delete` return shape** — `return {}` typed as `Promise<Empty>` is wire-compatible with `responseSerialize: (value: Empty) => Buffer.from(Empty.encode(value).finish())` (per `proto/generated/bci_devices.ts:288–289`). The generated controller interface lists `void | Promise<void>`, but the controller does not `implements BciDevicesServiceController`, so no TS structural mismatch arises. ✅
- **Service contracts** — `bciDeviceService.listForUser(user.sub)`, `register(user.sub, request.serial)`, `delete(user.sub, request.id)` all match the existing method signatures in `src/bci/bci-device.service.ts:15–66`. The service raises `NOT_FOUND` / `PERMISSION_DENIED` via `RpcException`, which the controller correctly does not wrap. ✅
- **No PII / sensitive data in logs** — the controller does not log at all. `request.serial` and user-identifying values never reach a log line. Aligns with `.ai-factory/RULES.md`'s "Never log sensitive data" and "Keep logs lean". ✅
- **No non-null assertions** — `user.sub` and `request.serial` / `request.id` are accessed only after the explicit `if (!user)` guard; no `!` operators introduced. ✅
- **Mapper added to the central location** — `toProtoBciDevice` is appended to `src/grpc/grpc-mappers.ts` alongside `toProtoUserDto`, `toProtoBreathSessionDto`, etc., matching project convention (rather than being placed file-local in the controller, as plan v1 incorrectly proposed). ✅
- **Modular monolith** — `@InjectRepository(BciDevice)` remains confined to `BciDeviceService`; the controller and the mapper deal only with the entity *type* (and via the service for fetching), not the repository. The `import type` lines in `grpc-mappers.ts` cross the `bci/entities/` boundary, but this is type-only and acceptable for the central-mapper file (which already crosses many module boundaries, e.g. `users/`, `breath-sessions/`). ✅

## Positive Notes

- The implementation matches the plan one-to-one — every import bullet, every method body, every error code is reproduced exactly. No drift between plan and code.
- The `if (!user)` defense-in-depth guard is correctly placed inside the handler body (not inside an `Observable` subscriber callback as in `sync-stream.grpc.controller.ts`) because all three RPCs are unary `Promise`-returning methods — appropriate for the unary case and avoids the streaming-subscriber pattern entirely.
- Naming and decorator-order match `sync-stream.grpc.controller.ts` (the explicit model called out by the milestone): `@Controller()` → `@UseFilters(GrpcExceptionFilter)` → `@UseInterceptors(GrpcAuthInterceptor)` → constructor → `@GrpcMethod` handlers.
- The mapper is purely a value→value conversion with no side effects, making it trivially testable in isolation should the milestone's "Testing: no" setting be revisited later.

REVIEW_PASS
