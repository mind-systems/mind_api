# Plan Review: BCI Device Service Tests (round 2)

**Plan:** `.ai-factory/plans/81-bci-device-service-tests.md`
**Target:** `src/bci/bci-device.service.spec.ts` (new spec, test-only)
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): Not consulted at root level for a test-only change; the plan stays inside the `bci` module and introduces no cross-module coupling. No boundary concerns. WARN (file not checked — not applicable to a unit-test plan).
- **Rules** (`mind_api/CLAUDE.md`): Plan respects "controllers are thin / entities belong to their module" — it tests a service directly and injects only the owning repo. Logging set to "minimal", consistent with a pure unit test. No violations.
- **Roadmap**: Test coverage task; no milestone linkage required. No `feat`/`fix`/`perf` semantics. OK.

## Verification Against the Codebase

I read `bci-device.service.ts`, `bci-device.entity.ts`, and sampled existing specs (`sync.service.spec.ts`, `module-state.grpc.controller.spec.ts`). The plan's assumptions hold:

- **Repo surface is correct.** The service uses exactly `find`, `update`, `findOneByOrFail`, `create`, `save` (register), `findOneBy`, `delete` (delete). The proposed `makeRepo()` shape `{ find, update, findOneByOrFail, findOneBy, create, save, delete }` matches all call sites — no missing or extra mock.
- **Direct instantiation is the established convention** (`new SyncService(changeLog as any)`), so `new BciDeviceService(repo as any)` is consistent.
- **Imports are correct.** `QueryFailedError` from `typeorm`, `RpcException` from `@nestjs/microservices`, `status as GrpcStatus` from `@grpc/grpc-js` — all match the real import sites and existing specs.
- **Branch coverage is complete.** `register` fast-vs-insert hinges on `(updateResult.affected ?? 0) > 0`; the plan covers `affected > 0`, `affected: 0`, and `affected: undefined`. The catch covers both arms of `instanceof QueryFailedError && code === '23505'`: matching code, mismatched code, undefined code, and non-`QueryFailedError`. `delete` covers null row → NOT_FOUND, foreign owner → PERMISSION_DENIED, happy path, the two "delete not called" negatives, and delete-error propagation.
- **The `updatedAt: () => 'CURRENT_TIMESTAMP'` assertion is valid** — the service passes a function literal, so asserting "second arg's `updatedAt` is a function returning `'CURRENT_TIMESTAMP'`" is exactly right and meaningfully distinguishes it from a literal.

## Critical Issues

None.

## Issues / Corrections

1. **`.error` property access will not compile (Notes #4 + Task 5).**
   The plan instructs: *"inspect its `.error` payload (`code`/`message`)"*. But `RpcException` declares the field as `private readonly error` (confirmed in `@nestjs/microservices/exceptions/rpc-exception.d.ts`). Accessing `(err as RpcException).error` is a TypeScript private-member access error and will fail `npm run build` / `ts-jest`. The public accessor is `getError()`, which is what the existing specs already use:
   ```ts
   expect((err as RpcException).getError()).toMatchObject({
     code: GrpcStatus.NOT_FOUND,
     message: 'BCI device not found',
   });
   ```
   **Action:** Replace every reference to `.error` with `.getError()` in Task 5 and Note #4. This is the one concrete change the implementer must make to avoid a compile failure.

## Minor Notes

- **`create` is synchronous.** When mocking the insert path, `create` must be `jest.fn().mockReturnValue(entity)` (not `mockResolvedValue`) — the service calls `create(...)` synchronously and only `await`s `save(...)`. Worth stating so the implementer doesn't mistakenly make `create` async.
- **Reject-shape assertion style.** For the delete guard cases, prefer `await expect(service.delete(...)).rejects.toBeInstanceOf(RpcException)` followed by a try/catch (or `.rejects.toThrow`) to then read `getError()`, since `rejects.toMatchObject` on an `RpcException` won't reach the private payload directly. The existing `done`-style controller specs use a callback; either works, but matching the `async/await + rejects` convention from `sync.service.spec.ts` keeps the file consistent.

## Positive Notes

- Branch enumeration is thorough and maps 1:1 to the real control flow — no dead test cases, no missing arm.
- Correctly identifies the subtle `affected ?? 0` nullish path as a distinct case from `affected: 0`.
- Correctly captures that the `23505` re-fetch must NOT re-bump `updatedAt` (the test only asserts the re-fetched row is returned), matching the service comment.
- Scope is appropriately test-only: no migration, no entity change, no module wiring — correctly omitted.

---
Because the `.error` → `.getError()` correction is required for the spec to compile, this is not a clean pass.
