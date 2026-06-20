# gRPC interceptor — accept Personal Access Tokens

**Date:** 2026-06-20
**Source:** conversation context

## Key Findings

- PATs are issued (`PersonalAccessTokenService.create` → `personal_access_tokens`, sha256-hashed) and the validator exists (`PersonalAccessTokenService.validateToken`), but **nothing on the request path ever calls it**. The only auth gate, `GrpcAuthInterceptor`, validates the bearer token strictly as a JWT.
- Net effect: every `pat_<hex>` token is rejected with `UNAUTHENTICATED / "Invalid authorization token"` because `jwtService.verifyAsync` throws on a non-JWT string. PAT auth is effectively dead — this is what blocks the `mind_mcp` MCP server (which authenticates with a PAT over gRPC).
- Confirmed against the live local DB: the freshly-issued PAT's sha256 matches a `personal_access_tokens` row (user "мак"), so the token and storage are correct — only the interceptor is missing the PAT branch.
- Fix is one file: branch on the `pat_` prefix in `GrpcAuthInterceptor` and validate PATs via `PersonalAccessTokenService.validateToken`, bypassing the JWT verify + `user_sessions` check (PATs are not session-backed).

## Details

### Current state

`src/grpc/grpc-auth.interceptor.ts` is applied via `@UseInterceptors(GrpcAuthInterceptor)` on every gRPC controller. Its flow:

1. Read `authorization` metadata, strip `Bearer ` → `token`.
2. If absent: `@GrpcOptionalAuth()` handlers continue with `user = null`; others throw `UNAUTHENTICATED "Missing authorization metadata"`.
3. `payload = await jwtService.verifyAsync<JwtPayload>(token)` — throws → `UNAUTHENTICATED "Invalid authorization token"`.
4. `sessionService.isValid(token)` — checks `user_sessions` by sha256 hash, updates `lastSeenAt`; false → `UNAUTHENTICATED "Session not found or revoked"`.
5. On success, stash on metadata via symbol keys `GRPC_USER_KEY` (the `JwtPayload`) and `GRPC_TOKEN_KEY` (the raw token); `@GrpcCurrentUser()` reads `GRPC_USER_KEY`.

`PersonalAccessTokenService.validateToken(rawToken)` (`src/users/service/personal-access-token.service.ts`): sha256 → `personal_access_tokens` lookup → load `User` → update `lastUsedAt` → returns `JwtPayload { sub, email, name }` or `null`. It is exported from `auth.module.ts` (alongside `SessionService`, `JwtService`), so it can be injected into the interceptor with no module rewiring.

### The change

In `GrpcAuthInterceptor.intercept`, after extracting `token`, branch on `token.startsWith('pat_')`:

- **PAT branch:** `payload = await this.patService.validateToken(token)`. If `null` → `RpcException UNAUTHENTICATED "Invalid authorization token"`. Do **not** call `jwtService.verifyAsync` and do **not** call `sessionService.isValid` — PATs live in `personal_access_tokens`, not `user_sessions`, so the session check would always fail. `validateToken` already records `lastUsedAt`.
- **JWT branch:** unchanged (verify + `sessionService.isValid`).
- Both branches converge on the existing `GRPC_USER_KEY` / `GRPC_TOKEN_KEY` assignment and `next.handle()`.

Inject `PersonalAccessTokenService` into the interceptor constructor.

### Guards / pitfalls

- Keep PATs out of `sessionService.isValid` — reusing the JWT path for PATs is exactly the present bug.
- Preserve `@GrpcOptionalAuth()` semantics: optional auth only bypasses when the token is **absent**. A present-but-invalid PAT under optional auth throws, matching current JWT behavior — do not silently null it.
- Branch on the `pat_` prefix (not "try JWT, fall back to PAT") to avoid a needless DB lookup on JWTs and to keep error messages crisp.
- Do not modify proto, DTOs, or any `.proto` (none involved) — this is server-side auth logic only.

### Verify

- Rebuild + restart the API. Call `BreathSessionService.ListSessions` over gRPC with `authorization: Bearer pat_<hex>` → returns the user's sessions (was `UNAUTHENTICATED`). The `mind_mcp` `list_my_breath_sessions` tool then works end-to-end against `localhost:50051`.
- JWT-authenticated calls still succeed; revoked/unknown PAT and revoked JWT still rejected.
- Optional-auth RPC (`GetSession` shared link) with no token still returns public data.

## Open Questions

- Should a PAT optionally be scoped (read-only vs full) rather than inheriting the full user identity? Out of scope here — current PATs grant full user access, matching JWT.
