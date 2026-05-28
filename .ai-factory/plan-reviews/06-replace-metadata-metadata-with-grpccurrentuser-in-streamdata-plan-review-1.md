# Plan Review: Replace `metadata?: Metadata` with `@GrpcCurrentUser()` in `streamData`

**Plan file:** `.ai-factory/plans/06-replace-metadata-metadata-with-grpccurrentuser-in-streamdata.md`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md** — OK. Change stays inside the `realtime` module and uses the cross-cutting `grpc/` decorator/interceptor pair. No new cross-module dependencies introduced.
- **RULES.md** — OK. The plan explicitly pairs `@Payload() request` with `@GrpcCurrentUser() user`, which directly satisfies the project rule: "Always use `@Payload()` on the request parameter in gRPC methods that also use `@GrpcCurrentUser()`". Without this pairing, `request` would be `undefined` at runtime — the plan gets it right.
- **ROADMAP.md** — Not checked against milestone linkage; this is a small refactor preparing for Phase 19 biometric controller and the rationale is stated in the plan's Context section.

## Verification Against Codebase

Verified against the live files:

- `src/realtime/module-instruction-stream.grpc.controller.ts` — current state matches what the plan describes:
  - Line 8: `import { status as GrpcStatus, Metadata } from '@grpc/grpc-js';` ✓
  - Line 21: `import { GRPC_USER_KEY } from '../grpc/grpc-auth.constants';` ✓
  - Lines 40–47: `streamData(request, metadata?: Metadata)` with the in-body `metadata[GRPC_USER_KEY]` extraction ✓
  - `@UseInterceptors(GrpcAuthInterceptor)` already applied (line 27) — so the metadata is populated and `GrpcCurrentUser` will read the same value ✓
- `src/realtime/module-state.grpc.controller.ts` — confirmed as the mirror target. `trackActivity(@Payload() request, @GrpcCurrentUser() user)` (lines 68–70) plus the identical `UNAUTHENTICATED` null-check (lines 73–81) match what Task 1 prescribes.
- `src/grpc/decorators/grpc-current-user.decorator.ts` — reads `(metadata as any)[GRPC_USER_KEY]`, which is exactly what the controller does inline today, so behavior is preserved.
- No spec/e2e file exists for `module-instruction-stream.grpc.controller.ts`, so skipping tests (per plan's `Testing: no`) introduces no broken test risk.

## Findings

### Critical Issues
None.

### Suggestions / Nits
- Task 2 says to drop the `Metadata` import from `@grpc/grpc-js` — confirmed `Metadata` is not referenced elsewhere in the file after the signature change, so the final import `import { status as GrpcStatus } from '@grpc/grpc-js';` is correct.
- The plan keeps the `JwtPayload` type import — still needed for the parameter annotation. Correct.
- No migration, no proto change, no consumer-side change needed (the wire format is unchanged; `GrpcAuthInterceptor` continues to attach the user under `GRPC_USER_KEY`). Plan's claim of zero behavior change is accurate.

### Positive Notes
- Plan explicitly mirrors the Phase 15 change to `ModuleStateGrpcController.trackActivity`, which is exactly the established convention in this codebase.
- Plan correctly anticipates the NestJS parameter-decorator gotcha (RULES.md rule) by adding `@Payload()` to the request parameter, not just `@GrpcCurrentUser()` to user.
- Build + lint verification step (Task 3) is appropriate scope given there are no specs to run and the change is purely a signature refactor.

PLAN_REVIEW_PASS
