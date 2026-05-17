# Plan: Replace `metadata?: Metadata` with `@GrpcCurrentUser() user: JwtPayload | null` in `trackActivity`

## Context
Align `ModuleStateGrpcController.trackActivity` with `SyncStreamGrpcController.watchChanges` by switching from raw `Metadata`-based user extraction to the typed `@GrpcCurrentUser()` parameter decorator. Pure refactor — no behavior change — required before adding unit tests (see `.ai-factory/notes/12-module-state-grpc-controller-test-plan.md`).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Refactor controller signature

- [x] **Task 1: Update `trackActivity` signature and remove metadata extraction**
  Files: `src/realtime/module-state.grpc.controller.ts`
  - Add imports: `Payload` from `@nestjs/microservices`, `GrpcCurrentUser` from `../grpc/decorators/grpc-current-user.decorator` (mirror the import style used in `src/realtime/sync-stream.grpc.controller.ts`).
  - Change the `trackActivity` signature from
    `trackActivity(request: Observable<StateRequest>, metadata?: Metadata): Observable<StateResponse>`
    to
    `trackActivity(@Payload() request: Observable<StateRequest>, @GrpcCurrentUser() user: JwtPayload | null): Observable<StateResponse>`.
  - `@Payload()` on `request` is mandatory per `.ai-factory/RULES.md` ("Always use `@Payload()` on the request parameter in gRPC methods that also use `@GrpcCurrentUser()`") — without it `request` will be `undefined` at runtime.
  - Inside the `Observable` constructor: delete the lines that derive `user` via `((metadata as any)[GRPC_USER_KEY] as JwtPayload | null)`; keep the existing `if (!user)` UNAUTHENTICATED guard (now checks the parameter directly) and the `const userId = user.sub;` line.
  - Do NOT touch `implements ModuleStateServiceController` if TypeScript accepts the wider parameter list; if `tsc` complains about the extra required `user` parameter mismatching the generated interface, drop the `implements ModuleStateServiceController` clause (matches the `SyncStreamGrpcController` pattern which does not implement its generated interface). The `@ModuleStateServiceControllerMethods()` class decorator stays — it registers `trackActivity` via `@GrpcStreamMethod` regardless of the `implements` clause.

- [x] **Task 2: Remove now-unused imports**
  Files: `src/realtime/module-state.grpc.controller.ts`
  - From `@grpc/grpc-js` import: drop `Metadata` (keep `status as GrpcStatus`).
  - Drop the import `import { GRPC_USER_KEY } from '../grpc/grpc-auth.constants';` — no longer referenced after Task 1.
  - Keep `JwtPayload` import (still used as the type of the `user` parameter).
  - Keep all other imports untouched.

### Phase 2: Verify build

- [x] **Task 3: Type-check the project**
  Files: (no edits)
  - Run `npm run build` to confirm TypeScript compiles cleanly with the new signature.
  - If `tsc` reports that `ModuleStateGrpcController` no longer satisfies `ModuleStateServiceController` because of the extra `user` parameter, apply the fallback noted in Task 1 (remove the `implements` clause) and re-run the build.
  - No runtime smoke test needed — the change is mechanical and the `GrpcAuthInterceptor` continues to attach the user onto `Metadata[GRPC_USER_KEY]`, which `@GrpcCurrentUser()` reads internally.
