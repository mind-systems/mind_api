# Review — Milestone 62: Replace `metadata?: Metadata` with `@GrpcCurrentUser()` in `trackActivity`

**Date:** 2026-05-17
**Reviewer:** Claude (code review pass)
**Scope:** `src/realtime/module-state.grpc.controller.ts`

## Diff summary

`git diff HEAD` shows the only source change is `src/realtime/module-state.grpc.controller.ts`. Other staged files are notes/plans/roadmap — not code.

The change:
1. Imports: `Payload` added from `@nestjs/microservices`; `Metadata` dropped from `@grpc/grpc-js`; `ModuleStateServiceController` dropped from the generated proto; `GRPC_USER_KEY` import dropped; `GrpcCurrentUser` added.
2. Class declaration: `implements ModuleStateServiceController` removed (now bare `export class ModuleStateGrpcController`).
3. Method signature: `trackActivity(request: Observable<StateRequest>, metadata?: Metadata)` → `trackActivity(@Payload() request: Observable<StateRequest>, @GrpcCurrentUser() user: JwtPayload | null)`.
4. Body: the 3-line metadata-extraction block (`const user = metadata ? ((metadata as any)[GRPC_USER_KEY] as JwtPayload | null) : null;`) deleted. The `if (!user)` guard and `const userId = user.sub;` lines are preserved verbatim.

## Correctness checks

- **`@Payload()` requirement (RULES.md).** Project rule mandates `@Payload()` on the request param whenever `@GrpcCurrentUser()` is on another param of the same handler; both decorators are present. ✓
- **Behavior parity.** `GrpcAuthInterceptor` writes `(metadata as any)[GRPC_USER_KEY] = payload` (`src/grpc/grpc-auth.interceptor.ts:74`). `GrpcCurrentUser` reads `(metadata as any)[GRPC_USER_KEY]` from `ctx.switchToRpc().getContext<Metadata>()` (`src/grpc/decorators/grpc-current-user.decorator.ts:8-10`). Same key, same metadata object — the value the handler sees is unchanged. ✓
- **Auth guard preserved.** `if (!user)` still errors with `UNAUTHENTICATED` before any side effects (register, reconnect). Order of operations is unchanged. ✓
- **Removal of `implements ModuleStateServiceController`.** The generated `@ModuleStateServiceControllerMethods()` class decorator applies `@GrpcStreamMethod("ModuleStateService", "trackActivity")` to the prototype regardless of the `implements` clause (`proto/generated/module_state.ts:515-527`). Matches `SyncStreamGrpcController`, which also omits the `implements` clause. No runtime impact. ✓
- **Bidi stream + `@Payload()`.** `trackActivity` is a bidi RPC (request is `Observable<StateRequest>`). NestJS binds `@Payload()` to the first positional arg of the gRPC handler, which for bidi is the inbound request stream — the `Observable<StateRequest>` flows through unchanged. The same pattern already works for the server-streaming `watchChanges`; per RULES.md it is the required pattern whenever `@GrpcCurrentUser()` is present. ✓
- **Unused imports cleaned up.** `Metadata` and `GRPC_USER_KEY` were the only references removed from this file; both genuinely have no remaining usages here (other controllers retain their own copies). `JwtPayload` import retained — still needed as the parameter type. ✓
- **TypeScript build.** `npx tsc --noEmit` runs clean — no type errors. ✓
- **No other callers affected.** `ModuleStateGrpcController` is referenced only in `src/realtime/realtime.module.ts` as a controller registration; no internal caller invokes `trackActivity` directly, so the new parameter list doesn't break anyone. No test files exist for it yet (the test plan in `.ai-factory/notes/12-...` is the follow-up).

## Out-of-scope observations (not findings)

- `ModuleInstructionStreamGrpcController.streamData` still uses the old `metadata?: Metadata` + `(metadata as any)[GRPC_USER_KEY]` pattern. That is intentional — this milestone scopes only `trackActivity`. A parallel migration for `streamData` would be a separate roadmap item.

## Conclusion

The change is a clean, behavior-preserving signature swap. Imports are tidy, the auth guard is intact, the project's gRPC decorator rule is followed, and the build is green.

REVIEW_PASS
