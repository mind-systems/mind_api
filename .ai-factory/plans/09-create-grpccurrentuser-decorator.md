# Plan: Create `@GrpcCurrentUser()` decorator

## Context
Add a param decorator that reads the authenticated user payload from gRPC execution context, eliminating manual JWT extraction scattered across all gRPC controllers. The `GrpcAuthInterceptor` already writes `JwtPayload` to `metadata[GRPC_USER_KEY]` (Symbol key) — the decorator reads it back.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Decorator

- [x] **Task 1: Create `@GrpcCurrentUser()` param decorator**
  Files: `src/grpc/decorators/grpc-current-user.decorator.ts`
  Use `createParamDecorator` from `@nestjs/common`. Inside the factory:
  1. Call `ctx.switchToRpc().getContext<Metadata>()` to get the gRPC metadata object.
  2. Read `(metadata as any)[GRPC_USER_KEY]` — this is where `GrpcAuthInterceptor` stores the `JwtPayload` (or `null` for optional-auth routes).
  3. Return the value typed as `JwtPayload | null`.

  Follow the pattern of the existing `@GrpcOptionalAuth()` decorator in the same directory (import constants from `../grpc-auth.constants`). Mirror the style of `src/users/decorators/current-user.decorator.ts` but switch from HTTP to RPC context.

  Import `Metadata` from `@grpc/grpc-js`, `GRPC_USER_KEY` from `../grpc-auth.constants`, `JwtPayload` from `../../users/interfaces/auth.interface`.

- [x] **Task 2: Export decorator from a barrel file**
  Files: `src/grpc/decorators/index.ts`
  Create a barrel `index.ts` that re-exports both `GrpcOptionalAuth` and `GrpcCurrentUser`. This gives controllers a single import path (`../grpc/decorators`) and matches NestJS convention for decorator directories.
