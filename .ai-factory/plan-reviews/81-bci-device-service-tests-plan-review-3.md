# Plan Review: BCI Device Service Tests (round 3)

**Plan:** `.ai-factory/plans/81-bci-device-service-tests.md`
**Target:** `src/bci/bci-device.service.spec.ts` (new spec, test-only)
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): Test-only change confined to the `bci` module. No cross-module coupling, no new boundaries, no dependency direction concerns. OK.
- **Rules** (`mind_api/CLAUDE.md` / `.ai-factory/RULES.md`): Plan tests the service directly and injects only the owning repository, consistent with "entities belong to their module" and "controllers are thin". Logging set to "minimal", appropriate for a pure unit test. No violations.
- **Roadmap**: Pure test-coverage task; no `feat`/`fix`/`perf` semantics, so no milestone linkage required. OK.
- **Skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): Not present. No project-specific overrides to apply.

## Verification Against the Codebase

I re-read `src/bci/bci-device.service.ts`, `src/bci/entities/bci-device.entity.ts`, a representative existing spec (`src/changelog/changelog.service.spec.ts`), and confirmed the `getError()` convention in `src/realtime/module-state.grpc.controller.spec.ts`. Every assumption in the plan holds:

- **Repo surface is exact.** The service calls `find`, `update`, `findOneByOrFail`, `create`, `save`, `findOneBy`, `delete`. The proposed `makeRepo()` shape `{ find, update, findOneByOrFail, findOneBy, create, save, delete }` is a 1:1 match — no missing or surplus mock.
- **Direct instantiation matches the established pattern** (`new ChangeLogService(repo as any)`), so `new BciDeviceService(repo as any)` is consistent.
- **Imports are correct.** `QueryFailedError` from `typeorm`, `RpcException` from `@nestjs/microservices`, `status as GrpcStatus` from `@grpc/grpc-js` — all match the real import sites.
- **Branch coverage is complete.** `register` fast-vs-insert hinges on `(updateResult.affected ?? 0) > 0`; the plan covers `affected > 0`, `affected: 0`, and `affected: undefined`. The catch covers both arms of `instanceof QueryFailedError && code === '23505'`: matching code, mismatched code, undefined code, and non-`QueryFailedError`. `delete` covers null row → NOT_FOUND, foreign owner → PERMISSION_DENIED, happy path, the two "delete not called" negatives, and delete-error propagation.
- **The `updatedAt: () => 'CURRENT_TIMESTAMP'` assertion is valid** — the service passes a function literal, so asserting the second arg's `updatedAt` is a function returning `'CURRENT_TIMESTAMP'` is precise and distinguishes it from a literal value.

## Prior-Round Feedback — All Resolved

- **`.error` → `.getError()` (round 2 blocking issue):** Fully fixed. The Conventions section now explicitly mandates `getError()`, explains that `.error` is `private readonly` and would fail `ts-jest` / `npm run build`, and both Task 5 and Note #4 use `getError()`. Confirmed against `@nestjs/microservices` usage in existing specs.
- **`create` is synchronous (round 2 minor):** Now captured in Conventions — mock with `mockReturnValue`, not `mockResolvedValue`.
- **Reject-shape assertion style (round 2 minor):** Now captured — `await expect(...).rejects.toBeInstanceOf(RpcException)` followed by a try/catch reading `getError()`, matching the async/await convention.
- **`QueryFailedError` constructor arity:** The plan spells out the three-arg constructor explicitly with a code example, removing the ambiguity.

## Critical Issues

None.

## Issues / Corrections

None.

## Positive Notes

- Branch enumeration maps 1:1 to the real control flow — no dead test cases, no missing arm.
- Correctly isolates the `affected ?? 0` nullish path as a distinct case from `affected: 0`.
- Correctly notes the `23505` re-fetch must NOT re-bump `updatedAt`, matching the service comment.
- Scope is appropriately test-only: no migration, no entity change, no module wiring.
- Every actionable item from rounds 1 and 2 is now baked into the Conventions/Notes sections, so the implementer has unambiguous guidance.

PLAN_REVIEW_PASS
