# Code Review: Replace `metadata?: Metadata` with `@GrpcCurrentUser()` in `streamData`

**Plan:** `.ai-factory/plans/06-replace-metadata-metadata-with-grpccurrentuser-in-streamdata.md`
**Changed files:**
- `src/realtime/module-instruction-stream.grpc.controller.ts` (modified)
- `.ai-factory/plans/06-...md` (new, plan artifact)
- `.ai-factory/plan-reviews/06-...-plan-review-1.md` (new, plan-review artifact)

## Scope

This change replaces the manual `metadata?: Metadata` + `metadata[GRPC_USER_KEY]` extraction in `ModuleInstructionStreamGrpcController.streamData` with the `@Payload()` / `@GrpcCurrentUser()` parameter-decorator pattern already in use by `ModuleStateGrpcController.trackActivity`. The plan was completed end-to-end (Tasks 1–3 checked).

## Verification of the diff

Read the post-change file in full (`module-instruction-stream.grpc.controller.ts`, 158 lines) and compared with the sibling `module-state.grpc.controller.ts`.

1. **Signature** — `streamData(@Payload() request: Observable<StreamSample>, @GrpcCurrentUser() user: JwtPayload | null)` matches the established convention (`trackActivity` lines 68–70 in `module-state.grpc.controller.ts`). The `@Payload()` decorator on the request stream is critical (NestJS gRPC parameter-decorator gotcha — without it, the param can resolve to `undefined`); the implementer applied it correctly.
2. **UNAUTHENTICATED null-check** — preserved verbatim at lines 44–52. Same behavior as before; `GrpcAuthInterceptor` still attaches the payload under `GRPC_USER_KEY`, and `GrpcCurrentUser` reads from that same key (`src/grpc/decorators/grpc-current-user.decorator.ts:9`), so the user-resolution semantics are byte-for-byte identical.
3. **Imports** —
   - Removed: `Metadata` (from `@grpc/grpc-js`), `GRPC_USER_KEY` (from `../grpc/grpc-auth.constants`), `ModuleInstructionStreamServiceController` (interface).
   - Added: `Payload` (from `@nestjs/microservices`), `GrpcCurrentUser` (from the decorator path).
   - `JwtPayload` kept (still needed for the parameter type annotation).
   - All removed symbols are no longer referenced in the file; no dead imports remain. Verified with a full read of the file.
4. **Sole `streamData` caller surface** — grepped `src/` for `streamData`; only the controller defines it, and NestJS dispatches it via the `@ModuleInstructionStreamServiceControllerMethods()` decorator registration (wire-level binding driven by the proto, not by the TS interface). No internal call sites need updating.
5. **Wire compatibility** — the gRPC contract is unchanged (no proto edits), so `mind_mcp` and `mind_mobile` consumers do not need regeneration. The over-the-wire metadata and message shapes are identical.

## Findings

### Critical Issues
None.

### Correctness / Runtime Concerns
None. The `if (!user)` branch still runs inside the `Observable` subscriber callback, so `subscriber.error(...)` followed by `return;` correctly aborts the stream creation before `registry.register` / inner `request.subscribe` run — same semantics as the original.

### Type Safety
- Dropping `implements ModuleInstructionStreamServiceController` was not in the written plan but is necessary and consistent with the sibling controller (`ModuleStateGrpcController` line 46 also does not implement its proto-generated interface). The generated interface declares `streamData(request, metadata?: Metadata)`, which no longer matches the new decorator-driven signature; keeping `implements` would have produced a TS2420 compile error. The implementer made the right call. The `@ModuleInstructionStreamServiceControllerMethods()` decorator handles the runtime gRPC method registration regardless.

### Style / Nits
- Param decorator ordering and formatting match the sibling controller — consistent.
- No log lines or behavior changed; the existing `Logger.log("Disconnected: userId=...")` and inner error branches are untouched.

### Documentation
- Plan said "Docs: no" — none required, and none added. Correct.

### Positive Notes
- The change is a near-perfect mirror of the Phase 15 refactor on `ModuleStateGrpcController`, which is exactly what Phase 19's new biometric controller needs as its template.
- The `@Payload()` pairing rule (a project-specific NestJS gotcha) is correctly applied.
- No proto, migration, or test surface impact — change is fully self-contained.

REVIEW_PASS
