# Plan: Add a PAT branch to `GrpcAuthInterceptor`

## Context
Make `GrpcAuthInterceptor` accept Personal Access Tokens (`pat_<hex>`) by validating them through the already-exported `PersonalAccessTokenService.validateToken`, so the `mind_mcp` MCP client can authenticate over gRPC. JWT auth behavior is unchanged.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Inject `PersonalAccessTokenService` into the interceptor**
  Files: `src/grpc/grpc-auth.interceptor.ts`
  Add the import `import { PersonalAccessTokenService } from '../users/service/personal-access-token.service';` and add it as a constructor parameter (e.g. `private readonly patService: PersonalAccessTokenService`). The service is already exported from `auth.module.ts`, and `GrpcAuthInterceptor` is provided in a module that imports `AuthModule`, so no module rewiring is needed. Confirm during implementation that the providing module has access to `AuthModule`'s exports; do not add new module imports unless DI fails.

- [x] **Task 2: Branch on the `pat_` prefix in `intercept`** (depends on Task 1)
  Files: `src/grpc/grpc-auth.interceptor.ts`
  After the existing `token` extraction and the `if (!token)` absent-token handling (lines ~42-53), branch before the current JWT logic:
  - When `token.startsWith('pat_')`: call `payload = await this.patService.validateToken(token)`. If it returns `null`, throw `new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Invalid authorization token' })` — the same message/code as the JWT-invalid path. Do **not** call `jwtService.verifyAsync` and do **not** call `sessionService.isValid` for this branch (PATs are not in `user_sessions`; the session check would always fail). `validateToken` already records `lastUsedAt`.
  - Otherwise (JWT branch): keep the existing logic unchanged — `jwtService.verifyAsync` (catch → `UNAUTHENTICATED "Invalid authorization token"`) followed by `sessionService.isValid` (false → `UNAUTHENTICATED "Session not found or revoked"`).
  - Declare `payload` so both branches assign it (e.g. `let payload: JwtPayload`), then converge on the existing `GRPC_USER_KEY` / `GRPC_TOKEN_KEY` metadata assignment and `return next.handle()`. Note `validateToken` returns `JwtPayload | null`; after the `null` check the type narrows to `JwtPayload`, so no non-null assertion (`!`) is needed — per project rules, do not use `!`.
  - Preserve `@GrpcOptionalAuth()` semantics: optional auth still only bypasses when the token is **absent** (the existing `if (!token)` block). A present-but-invalid PAT must throw, exactly like a present-but-invalid JWT — do not silently null it.

- [x] **Task 3: Verify the build** (depends on Task 2)
  Files: `src/grpc/grpc-auth.interceptor.ts`
  Run `npm run build` (and `npm run lint`) to confirm the interceptor compiles with the new dependency and branch, and that no type or lint errors were introduced. No proto, DTO, DB, or migration changes are involved.
