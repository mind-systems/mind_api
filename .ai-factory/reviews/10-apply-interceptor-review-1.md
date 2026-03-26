## Code Review Summary

**Files Reviewed:** 11
**Risk Level:** 🟡 Medium

### Context Gates
- **ARCHITECTURE.md** — WARN: Architecture states "Controllers are thin" and "Guards are the access control boundary." The dead auth-check blocks inside controller methods duplicate logic that belongs solely to the interceptor, violating the thin-controller principle.
- **RULES.md** — No violations.
- **ROADMAP.md** — Changes correspond to roadmap item 1.4 "Apply interceptor." No missing linkage.

### Critical Issues

None.

### Suggestions

**1. Dead auth guard blocks in every protected method**

The `GrpcAuthInterceptor` already rejects unauthenticated requests (throws `UNAUTHENTICATED`) before the method body runs. Every `if (!user)` / `if (!token)` block inside protected methods is dead code that can never execute.

Affected locations:
- `auth.grpc.controller.ts` — `logout` (lines 79-84), `createToken` (94-98), `listTokens` (117-122), `deleteToken` (139-144)
- `breath-sessions.grpc.controller.ts` — `createSession` (56-61), `getSuggestions` (96-101), `updateSession` (144-149), `replaceSession` (180-185), `updateSessionSettings` (206-211), `deleteSession` (224-230)
- `users.grpc.controller.ts` — `updateProfile` (31-36)
- `stats.grpc.controller.ts` — `getStats` (29-34)
- `sync.grpc.controller.ts` — `getChanges` (27-29)

The plan explicitly calls for removing these blocks: *"remove the `if (!user)` guard block (the interceptor rejects unauthenticated calls before the method runs)."* Keeping them contradicts the purpose of the interceptor refactor and misleads future developers into thinking the interceptor might not protect the route.

Fix: delete all `if (!user)` / `if (!token)` blocks from interceptor-protected methods.

**2. Inaccurate optional parameter types on protected methods**

Protected methods declare `user?: JwtPayload` (optional) even though the interceptor guarantees the parameter is always populated. The plan specifies non-optional types: `user: JwtPayload`.

Current:
```typescript
async createToken(request: CreateTokenRequest, @GrpcCurrentUser() user?: JwtPayload)
```

Should be:
```typescript
async createToken(request: CreateTokenRequest, @GrpcCurrentUser() user: JwtPayload)
```

Same fix applies to `logout` (`token?: string` → `token: string`) and every other protected method across all controllers. Optional-auth methods (`listSessions`, `batchGetSessions`, `getSession`) correctly use `JwtPayload | null` and should stay as-is.

**3. Unused imports after dead code removal**

Once the dead auth blocks are removed, `RpcException` and `GrpcStatus` will become unused in two controllers:
- `stats.grpc.controller.ts` — both imports unused (no other usage)
- `auth.grpc.controller.ts` — both imports unused (`logout` no longer throws manually)

Other controllers still need them: `breath-sessions` (INVALID_ARGUMENT in `batchGetSessions`), `users` (INVALID_ARGUMENT in `updateProfile`), `sync` (UNAUTHENTICATED in `getChanges` — also dead, but if removed, `RpcException`/`GrpcStatus` become unused too).

**4. Inconsistent nullability in `SyncGrpcController.getChanges`**

`getChanges` declares `user: JwtPayload | null` while all other required-auth methods use `user?: JwtPayload`. Since the class-level interceptor (without `@GrpcOptionalAuth()`) guarantees non-null, the correct type is `user: JwtPayload` — consistent with the fix in suggestion 2.

### Positive Notes

- DI wiring is correct across all modules — every module that uses `GrpcAuthInterceptor` imports `AuthModule`, which exports `JwtModule` and `SessionService`
- `GrpcToken` decorator cleanly follows the established `GrpcCurrentUser` pattern using Symbol keys
- `DeviceGrpcController` correctly left without the interceptor (fully public)
- Clean per-method vs class-level interceptor split: `AuthGrpcController` (mixed public/protected) uses per-method, all others use class-level
- `SessionService` correctly retained in `AuthGrpcController` for `revoke()` while removed from all other controller constructors
- `GrpcOptionalAuth` correctly applied to the three optional-auth methods in `BreathSessionsGrpcController`
