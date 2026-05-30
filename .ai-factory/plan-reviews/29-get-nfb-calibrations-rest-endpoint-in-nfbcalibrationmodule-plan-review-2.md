# Plan Review: GET /nfb-calibrations REST endpoint in NfbCalibrationModule

**Plan:** `.ai-factory/plans/29-get-nfb-calibrations-rest-endpoint-in-nfbcalibrationmodule.md`
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — PASS. Modular monolith respected: the new REST controller stays inside `NfbCalibrationModule`. `JwtAuthGuard` is consumed via the already-imported `AuthModule` (`src/users/auth.module.ts:53-62`). No cross-module entity reach (`@InjectRepository(NfbCalibrationRecord)` remains scoped to its owner module).
- **Rules (`.ai-factory/RULES.md`)** — PASS. No `!` non-null assertions, no PII logging, no changes to the gRPC handler signature that would violate the `@Payload()` requirement (the gRPC controller already declares `@Payload() request`).
- **Roadmap (`.ai-factory/ROADMAP.md`)** — PASS. Plan corresponds to the unchecked Milestone 21 item at `ROADMAP.md:89` and matches the spec at `.ai-factory/notes/10-web-dashboard-rest-api-spec.md:157-191`.

## Critical Issues

None. Both critical issues from review-1 have been addressed:

1. **gRPC `limit = 0` regression** — Task 1 now specifies `const take = Math.min(limit && limit > 0 ? limit : 50, 200);`. This preserves the proto contract (`proto/nfb_calibration.proto:50` documents `0 = server default (50)`) for gRPC while still capping any caller at 200. Verified that with this guard:
   - REST: missing param → `undefined` → 50 (via the truthy guard, not via the default parameter).
   - gRPC: `request.limit = 0` → 50 (via the `limit > 0` check).
   - Both: any `limit > 200` → clamped to 200.

2. **Empty `deviceSerial` semantic change** — Task 2 now explicitly calls out the behavior change (gRPC empty `device_serial` → "all caller's devices"), justifies it against the spec at `notes/10-web-dashboard-rest-api-spec.md:191`, and notes the current mobile client (`mind_mobile/lib/Bci/NfbCalibrationGrpcApi.dart:28`) always sends a real serial so there is no production regression. The accepted behavior is also captured in the Commit 1 body.

## Minor Issues / Suggestions

### 1. Proto contract documentation drift (non-blocking)

The plan accepts the new "empty `device_serial` means all devices" gRPC behavior but does **not** update `proto/nfb_calibration.proto:49` to document the contract. The proto comment currently says nothing about empty-string semantics. A consumer reading the `.proto` will not know this. Adding `// "" = all devices for the caller` next to `string device_serial = 1;` would close the gap. Not blocking — the plan is internally consistent — but worth doing in a follow-up if the field is intentionally overloaded.

### 2. Response shape lock-in (non-blocking)

Task 4 returns the raw `NfbCalibrationRecord` entity in the `records` array. The entity exposes `userId` (always the authenticated caller's own id, so not a privacy leak) and ties the HTTP wire format to the DB column layout. Plan acknowledges this and explicitly accepts no separate DTO mapper — consistent with the lightweight precedent in `src/sessions/sessions.controller.ts` which also returns service output directly. Acceptable trade-off.

### 3. No tests — acceptable given `Testing: no`

There are no `*.spec.ts` files under `src/nfb-calibration/` or `src/sessions/`, so the project convention here is "no specs". The plan's `Testing: no` setting matches. Just note that there is no automated coverage for the Task 1 limit-guard fix — manual sanity check after implementation would be prudent.

## Positive Notes

- **Both review-1 critical issues addressed inline with concrete code.** Task 1 now codifies the `limit && limit > 0` guard rather than copying the spec's blind spot; Task 2 explicitly documents the empty-`deviceSerial` semantic change with an escape hatch (`RpcException` snippet) if a future reviewer disagrees.
- **Import paths verified accurate:** `JwtAuthGuard` from `../users/guards/jwt-auth.guard`, `CurrentUser` from `../users/decorators/current-user.decorator`, `JwtPayload` (type-only) from `../users/interfaces/auth.interface`, `FindOptionsWhere` from `typeorm` — all match the actual source files.
- **`AuthModule` already in `NfbCalibrationModule.imports`** (`src/nfb-calibration/nfb-calibration.module.ts:9`); the plan correctly identifies that Task 5 only needs to add the new controller to the `controllers` array — no `imports:` change required.
- **DTO validation choices (`@Type(() => Number)`, `@IsInt()`, `@Min`/`@Max`, `@IsOptional`)** are correct for query-string parsing under the global transforming `ValidationPipe` at `main.ts:80-86`.
- **Pagination shape (`findAndCount`, `take`, `skip`)** mirrors `SessionsService.listRuns` exactly — good precedent reuse.
- **Commit split (signature change → REST surface)** is sensible: Commit 1 keeps gRPC green and documents the empty-serial change in the body; Commit 2 adds the new HTTP surface area on top.
- **No migration required** — the entity and table already exist (Milestone 19); the plan correctly omits a migration step.

## Verdict

All critical issues from review-1 are resolved. The remaining suggestions (proto comment, DTO wrapper, test absence) are non-blocking style/documentation notes. Plan is ready for implementation.

PLAN_REVIEW_PASS
