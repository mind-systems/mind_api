# Code Review: MeditationPosesService

**Plan:** `.ai-factory/plans/52-meditationposesservice.md`
**Scope:** Rename `MeditationPosesService.listPoses()` → `listAll()` and update its single call site.
**Risk Level:** 🟢 Low

## Changes Reviewed

- `src/meditation-poses/meditation-poses.service.ts` — method `listPoses()` renamed to `listAll()`; body unchanged (`this.repo.find({ order: { displayOrder: 'ASC' } })`).
- `src/meditation-poses/meditation-poses.grpc.controller.ts` — call site updated from `listPoses()` to `listAll()`.

## Correctness

- **Call site fully updated.** A repo-wide grep for `listPoses`/`listAll` confirms the only remaining `listPoses` occurrences are the gRPC wire-contract name (`@GrpcMethod('MeditationPosesService', 'listPoses')`) and the controller handler method, both of which must stay. The sole service call site now uses `listAll()`. No dangling reference to the renamed method.
- **No test references.** `test/` has no references to the service or either method name, so the rename breaks no existing tests.
- **Behavior preserved.** The query body is byte-for-byte unchanged: ordered by `displayOrder ASC`, no user context, filtering, or pagination — matching the spec (`notes/34-meditation-poses-service.md`).
- **TypeScript safety net.** Had any call site been missed, `npm run build` would fail on a call to a now-nonexistent method; the change compiles because the only caller was updated.

## Security & Architecture

- No security surface change. The controller still rejects missing user context with `UNAUTHENTICATED` before invoking the service.
- `@InjectRepository(MeditationPose)` remains confined to `MeditationPosesModule` — modular-monolith boundary respected.
- No schema change, so no migration is required.
- Rules (`RULES.md`): no non-null assertions, no sensitive logging, no new `@GrpcCurrentUser()` parameters — compliant.

## Observations (non-blocking)

- The gRPC method name and the service method name now differ (`listPoses` on the wire, `listAll` in the service). This is intentional and correct — the proto RPC name is the external contract and must not change — but the divergence is mild cognitive friction for future readers.

REVIEW_PASS
