## Code Review Summary

**Files Reviewed:** 3 (`breath-sessions.grpc.controller.ts`, `grpc-mappers.ts`, `breath-sessions.module.ts`)
**Risk Level:** 🔴 High

### Context Gates

- **ARCHITECTURE.md** — WARN: No boundary violations. Controller is thin, delegates to services. Module registration correct.
- **RULES.md** — ERROR: Non-null assertion operator (`!`) used 6 times in `breath-sessions.grpc.controller.ts`. Rule says "NEVER use non-null assertion operator".
- **ROADMAP.md** — WARN: Milestone 1.3 `breath-sessions.grpc.controller.ts` is checked off. No issues.

### Critical Issues

1. **RULES.md violation: `!` operator used 6 times** — `src/breath-sessions/breath-sessions.grpc.controller.ts`

   Lines 56, 92, 151, 163, 183, 195 all use `user!.sub`. The project rule explicitly forbids this:

   > `payload.email!` — forbidden. Always use an explicit check.

   Both `AuthGrpcController` (lines 94, 117, 139) and `UsersGrpcController` (line 31) use explicit `if (!user)` guards before accessing `user.sub`. The breath sessions controller must follow the same pattern.

   **Fix:** Add an explicit guard at the top of each auth-required method:

   ```typescript
   async createSession(
     request: CreateSessionRequest,
     @GrpcCurrentUser() user?: JwtPayload,
   ): Promise<BreathSessionDto> {
     if (!user) {
       throw new RpcException({
         code: GrpcStatus.UNAUTHENTICATED,
         message: 'Authentication required',
       });
     }
     const session = await this.breathSessionsService.create(user.sub, { ... });
   ```

   Affected methods (all 6 non-optional-auth methods): `createSession`, `getSuggestions`, `updateSession`, `replaceSession`, `updateSessionSettings`, `deleteSession`.

### Suggestions

1. **`fromProtoTimeOfDay` silently defaults to MORNING for unrecognized values** — `src/grpc/grpc-mappers.ts:72-73`

   If a client sends `TimeOfDay.UNRECOGNIZED` (-1) or a future enum value, it is silently mapped to `TimeOfDay.MORNING`. This could cause data corruption that's hard to trace. Consider throwing instead:

   ```typescript
   default:
     throw new RpcException({
       code: GrpcStatus.INVALID_ARGUMENT,
       message: `Unknown TimeOfDay value: ${tod}`,
     });
   ```

2. **`fromProtoStepType` silently defaults to 'inhale' for unrecognized values** — `src/grpc/grpc-mappers.ts:118-119`

   Same issue. `StepType.UNRECOGNIZED` (-1) silently becomes `'inhale'`. A step with the wrong type changes the entire exercise structure.

### Positive Notes

- Clean mapper/controller separation — all proto conversion logic lives in `grpc-mappers.ts` as pure functions, keeping the controller thin
- Correct use of `@GrpcOptionalAuth()` on `listSessions`, `batchGetSessions`, `getSession` — matches the proto contract (auth optional)
- Proper PATCH semantics in `updateSession` — the `ExerciseList` wrapper correctly enables presence tracking for the `exercises` field
- Batch validation (1-50 IDs) in `batchGetSessions` matches the proto contract comment
- `GrpcExceptionFilter` transparently converts `NotFoundException` / `ForbiddenException` from service layer to correct gRPC status codes
- Module registration is clean — HTTP controller already removed (Phase 4.1), only gRPC controller registered
