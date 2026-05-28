# Plan: Replace `metadata?: Metadata` with `@GrpcCurrentUser()` in `streamData`

## Context
Migrate `ModuleInstructionStreamGrpcController.streamData` to extract the authenticated user via the `@GrpcCurrentUser()` parameter decorator (mirroring Phase 15's change to `ModuleStateGrpcController`), so the new biometric controller landing in Phase 19 can mirror this pattern exactly. No behavior change — just the user-resolution mechanism.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Migrate `streamData` signature

- [x] **Task 1: Switch `streamData` to use `@GrpcCurrentUser()`**
  Files: `src/realtime/module-instruction-stream.grpc.controller.ts`
  - Replace the `metadata?: Metadata` parameter on `streamData` (lines 40-47) with two decorated parameters that match `ModuleStateGrpcController.trackActivity`:
    - `@Payload() request: Observable<StreamSample>`
    - `@GrpcCurrentUser() user: JwtPayload | null`
  - Remove the in-body extraction block:
    ```ts
    const user = metadata
      ? ((metadata as any)[GRPC_USER_KEY] as JwtPayload | null)
      : null;
    ```
    Use the injected `user` parameter directly.
  - Keep the existing `UNAUTHENTICATED` null-check (`if (!user) subscriber.error(new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' })); return;`) verbatim — same shape as `trackActivity`.
  - The rest of the method body (`const userId = user.sub;` and downstream logic) stays unchanged.

- [x] **Task 2: Clean up imports** (depends on Task 1)
  Files: `src/realtime/module-instruction-stream.grpc.controller.ts`
  - Drop the now-unused `GRPC_USER_KEY` import (`import { GRPC_USER_KEY } from '../grpc/grpc-auth.constants';`).
  - Drop the `Metadata` import from `@grpc/grpc-js` (line 8) — keep `status as GrpcStatus`. The import becomes: `import { status as GrpcStatus } from '@grpc/grpc-js';`.
  - Add the imports needed for the new signature, matching the style used in `module-state.grpc.controller.ts`:
    - `Payload` from `@nestjs/microservices` (extend the existing `import { RpcException } from '@nestjs/microservices';` to `import { Payload, RpcException } from '@nestjs/microservices';`).
    - `GrpcCurrentUser` from `../grpc/decorators/grpc-current-user.decorator`.
  - Keep the existing `JwtPayload` type import as-is.

- [x] **Task 3: Verify build & lint** (depends on Task 2)
  Files: —
  - Run `npm run build` to confirm the TypeScript change compiles cleanly.
  - Run `npm run lint` to catch any unused-import or formatting issues.
  - No runtime behavior change is expected; existing gRPC clients must continue to work because `GrpcAuthInterceptor` still attaches the user to metadata under `GRPC_USER_KEY` and the decorator reads from the same source.

<!-- orchestrator-sessions
planner: f3a1150a-36d0-4860-ab61-bec2b68050d5
elapsed: 361
implementer: 074723f7-917e-4826-859d-a3e0cb2dad00
-->
