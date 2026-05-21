# Plan: `BciDevicesGrpcController`

## Context
Wire up the three unary RPCs (`list`, `register`, `delete`) on the existing stub `BciDevicesGrpcController` at `src/bci/bci-devices.grpc.controller.ts`. Each RPC injects the authenticated user via `@GrpcCurrentUser()`, delegates to `BciDeviceService`, and maps the `BciDevice` entity to the generated proto message (with `Date → ISO-8601 string` conversion).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implement controller RPCs

- [x] **Task 1: Add `toProtoBciDevice` mapper to `src/grpc/grpc-mappers.ts`**
  Files: `src/grpc/grpc-mappers.ts`
  Add a new exported mapper next to the existing `toProtoUserDto` / `toProtoBreathSessionDto` mappers — `src/grpc/grpc-mappers.ts` is the central, project-wide home for `toProto*` mappers (verified against the existing `toProtoUserDto` at line 29, `toProtoBreathSessionDto` further down). Placing it there matches the project convention; the controller will import it.
  Append at the bottom of the file:
  ```ts
  export function toProtoBciDevice(entity: BciDevice): BciDeviceProto {
    return {
      id: entity.id,
      serial: entity.serial,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
  ```
  Imports to add at the top of `grpc-mappers.ts` (follow the existing `import type` style — lines 1, 2, 8-12 already use `import type` for proto and entity types):
  - `import type { BciDevice as BciDeviceProto } from '../../proto/generated/bci_devices';`
  - `import type { BciDevice } from '../bci/entities/bci-device.entity';`
  The `BciDevice` symbol collision (entity vs proto message) is resolved up front by aliasing the proto type to `BciDeviceProto`.
  The milestone requires ISO-8601 strings via `.toISOString()` — same convention used by `SyncEventDto` in `src/realtime/sync-stream.grpc.controller.ts` line 126 (`e.createdAt.toISOString()`).

- [x] **Task 2: Implement the `list` RPC** (depends on Task 1)
  Files: `src/bci/bci-devices.grpc.controller.ts`
  Add a `list` method on the existing `BciDevicesGrpcController` class:
  ```ts
  @GrpcMethod('BciDevicesService', 'list')
  async list(
    @Payload() _request: Empty,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ListBciDevicesResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const devices = await this.bciDeviceService.listForUser(user.sub);
    return { devices: devices.map(toProtoBciDevice) };
  }
  ```
  Imports to add at the top of `src/bci/bci-devices.grpc.controller.ts` — each line must use the exact syntax shown below (no shorthand):
  - `import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';`
  - `import { status as GrpcStatus } from '@grpc/grpc-js';`
  - `import { ListBciDevicesResponse, RegisterBciDeviceRequest, DeleteBciDeviceRequest, BciDevice as BciDeviceProto } from '../../proto/generated/bci_devices';`
  - `import { Empty } from '../../proto/generated/google/protobuf/empty';`
  - `import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';`
  - `import type { JwtPayload } from '../users/interfaces/auth.interface';` — note the full `import type { ... }` form (matches the existing style in `src/realtime/sync-stream.grpc.controller.ts` line 19); do **not** shorthand to `import { type JwtPayload }`.
  - `import { toProtoBciDevice } from '../grpc/grpc-mappers';`
  Within the controller, `BciDeviceProto` is the proto type used in mapped return shapes (and indirectly via `ListBciDevicesResponse.devices`); the entity type `BciDevice` is not imported here because the entity is only handled inside the service and the mapper.
  **Mandatory:** the `@Payload()` decorator on the request parameter is required by `.ai-factory/RULES.md` — when any parameter uses `@GrpcCurrentUser()`, NestJS switches to explicit injection mode and the request parameter would otherwise be `undefined`. The leading underscore (`_request`) signals the parameter is intentionally unused (matches the project's ESLint convention).

- [x] **Task 3: Implement the `register` RPC** (depends on Task 2)
  Files: `src/bci/bci-devices.grpc.controller.ts`
  Add the `register` method below `list`:
  ```ts
  @GrpcMethod('BciDevicesService', 'register')
  async register(
    @Payload() request: RegisterBciDeviceRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<BciDeviceProto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const device = await this.bciDeviceService.register(user.sub, request.serial);
    return toProtoBciDevice(device);
  }
  ```
  Do not validate `request.serial` here (no length / format checks beyond what protobuf already enforces) — the milestone description does not require body validation at the controller, and the service does not require it. `RegisterBciDeviceDto` (created in milestone 3) is intentionally not used here: gRPC controllers receive the generated proto request type directly, not the `class-validator` DTO.

- [x] **Task 4: Implement the `delete` RPC** (depends on Task 3)
  Files: `src/bci/bci-devices.grpc.controller.ts`
  Add the `delete` method:
  ```ts
  @GrpcMethod('BciDevicesService', 'delete')
  async delete(
    @Payload() request: DeleteBciDeviceRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<Empty> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    await this.bciDeviceService.delete(user.sub, request.id);
    return {};
  }
  ```
  `Delete` returns `Empty` (`{}`) per the milestone description and the proto definition (`returns (google.protobuf.Empty)`). The service already raises `RpcException` with `NOT_FOUND` / `PERMISSION_DENIED` for the not-found and ownership-mismatch cases — the controller does not re-handle these.

### Phase 2: Verification

- [x] **Task 5: Verify the project compiles and lints** (depends on Task 4)
  Files: (no file changes)
  From `mind_api/`, run:
  - `npm run build` — confirm TypeScript compiles with the new RPC methods, mapper, proto imports, and the `BciDevice` / `BciDeviceProto` alias.
  - `npm run lint` — confirm no lint errors in `src/bci/bci-devices.grpc.controller.ts` and `src/grpc/grpc-mappers.ts` (in particular the `_request` unused-parameter convention and the imports ordering).
  Note: the existing stub at `src/bci/bci-devices.grpc.controller.ts` already uses relative imports (`../grpc/grpc-exception.filter`, `../grpc/grpc-auth.interceptor`) consistent with `src/realtime/sync-stream.grpc.controller.ts` — no normalization needed.
  No runtime verification required — the orchestrator's review step covers correctness.

## Commit Plan
- **Commit 1** (after tasks 1-5): "Implement BciDevicesGrpcController list/register/delete RPCs"
