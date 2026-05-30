# Plan Review: GET /nfb-calibrations REST endpoint in NfbCalibrationModule

**Plan:** `.ai-factory/plans/29-get-nfb-calibrations-rest-endpoint-in-nfbcalibrationmodule.md`
**Risk Level:** 🟡 Medium

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — PASS. Modular monolith respected: new REST controller stays inside `NfbCalibrationModule`, `JwtAuthGuard` consumed via the already-imported `AuthModule` (exported list confirmed in `src/users/auth.module.ts:53-62`). No cross-module entity reach.
- **Rules (`.ai-factory/RULES.md`)** — PASS. No `!` non-null assertions, no PII logging, no gRPC `@GrpcCurrentUser` changes that would trip the `@Payload()` requirement (the gRPC handler already complies).
- **Roadmap (`.ai-factory/ROADMAP.md`)** — PASS. Plan corresponds to the unchecked Milestone 5 item (`ROADMAP.md:89`) and matches the spec in `notes/10-web-dashboard-rest-api-spec.md:157-191`.

## Critical Issues

### 1. gRPC regression — `request.limit = 0` will return zero records

**Where:** Task 1 (`nfb-calibration.service.ts`) + Task 2 (gRPC controller call site).

The current service body is:

```ts
take: limit || 50,
```

The proto explicitly documents the contract (`proto/nfb_calibration.proto:50`):

```proto
int32 limit = 2;            // 0 = server default (50)
```

The plan replaces the body with `take: Math.min(limit, 200)` and leaves the gRPC call site as `this.nfbCalibrationService.list(user.sub, request.deviceSerial, request.limit, 0)`. The default parameter `limit = 50` is **not** triggered when the caller passes `0` — only `undefined` triggers it. So `Math.min(0, 200) === 0`, and TypeORM's `take: 0` returns an empty array.

This silently breaks every gRPC caller that relies on the documented "0 = server default" behavior. (`mind_mobile/lib/Bci/NfbCalibrationGrpcApi.dart:28` happens to always send a positive `limit`, but the proto contract is public and the mobile default could change.)

**Fix options:**

- In the service: `const take = Math.min(limit && limit > 0 ? limit : 50, 200);` — preserves both REST (`undefined` → 50) and gRPC (`0` → 50).
- Or at the gRPC call site: `await this.nfbCalibrationService.list(user.sub, request.deviceSerial, request.limit || undefined, 0);`.

The spec in `notes/10-web-dashboard-rest-api-spec.md:169-191` has the same blind spot — the plan should be the place this is fixed rather than copied through.

### 2. gRPC semantic change — empty `deviceSerial` now returns all serials

**Where:** Task 1 + Task 2.

Today the service does `where: { userId, deviceSerial }`. When the gRPC `ListNfbCalibrationsRequest.device_serial` is the proto default `""`, TypeORM filters by literal empty string and returns nothing (or only rows that were stored with an empty serial — none in practice).

The plan switches to "skip WHERE filter if `deviceSerial` is empty" and explicitly leaves the gRPC controller passing `request.deviceSerial` through unchanged. After this change, a gRPC `List` call with an empty `device_serial` returns **all** of the caller's calibration records across every device — a different and broader result set than before.

Task 2's note ("empty string means 'all'") asserts a semantic that is **not** declared anywhere in the proto. The mobile client always passes a real serial today, so this is not a runtime regression in production right now, but the contract change is real.

**Recommendation:** either

- Update `proto/nfb_calibration.proto` to document `string device_serial = 1; // "" = all devices` and explicitly accept the broader behavior as intentional, or
- Keep gRPC's pre-existing strict behavior by guarding at the gRPC call site: `request.deviceSerial || undefined` becomes `""` → skip filter; pass `request.deviceSerial` straight through only when non-empty. The plan should pick one and state it.

At minimum, the plan should flag this as a behavior change rather than treating it as a no-op.

## Minor Issues / Suggestions

### 3. REST response leaks the entity rather than a DTO

Task 4 returns the raw `NfbCalibrationRecord` entity as the `records` array. This includes the `userId` column (the authenticated caller's own id, so not a real privacy leak) and locks the HTTP shape to the DB row shape. The spec in `notes/10-web-dashboard-rest-api-spec.md:164` calls these `NfbCalibrationRecordDto[]`, suggesting a DTO mapper. Not blocking, but worth a sentence in the plan: "return the entity directly (camelCase TypeORM property names) — no separate DTO since the entity has no sensitive columns."

### 4. `query.limit` / `query.offset` undefined-flow is fine but worth confirming

`main.ts:80-86` sets a global `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })`, so missing query params arrive as `undefined`, not `0`. Combined with the service defaults (`limit = 50`, `offset = 0`), REST behaves correctly. Confirms the plan's signature choice; no change required.

### 5. No tests, no docs — acceptable given the plan's stated settings, but mark the assumption

Plan declares `Testing: no` / `Docs: no`. There are no existing `*.spec.ts` files under `src/nfb-calibration/`, so no specs to update. Sessions endpoints under `src/sessions/` also lack specs, so this matches the project's current convention. Just noting that the gRPC call-site change in Task 2 has no automated coverage to catch issue #1.

## Positive Notes

- File layout (`nfb-calibration.rest.controller.ts`, `dto/list-nfb-calibrations-query.dto.ts`) mirrors `src/sessions/` precedents correctly.
- Import paths are accurate: `JwtAuthGuard` from `../users/guards/jwt-auth.guard`, `CurrentUser` from `../users/decorators/current-user.decorator`, `JwtPayload` (type-only) from `../users/interfaces/auth.interface` — all verified against the actual files.
- `AuthModule` is already in `NfbCalibrationModule.imports` (`src/nfb-calibration/nfb-calibration.module.ts:9`), so no module wiring beyond the new controller registration is needed — the plan correctly notes this.
- Pagination cap (`Math.min(limit, 200)`) and `findAndCount` usage match `SessionsService.listRuns` (`src/sessions/sessions.service.ts:53-61`) exactly.
- DTO validation choices (`@Type(() => Number)`, `@IsInt()`, `@Min/@Max`) are correct for query-string parsing under the global transforming `ValidationPipe`.
- Commit split (signature change → REST surface) is sensible — the first commit keeps gRPC green and the second adds the new surface area.

## Verdict

Two real correctness/contract concerns (#1 critical, #2 important semantic change) need to be addressed in the plan before implementation. Architecture, file paths, imports, module wiring, and validation are all correct.