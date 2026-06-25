# Plan Review: NFB Calibration Service Tests

**Plan:** `82-nfb-calibration-service-tests.md`
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): OK. Plan adds only a co-located `*.spec.ts` next to the service it tests — consistent with the modular-monolith folder layout. No boundary or dependency concerns.
- **Rules** (`.ai-factory/RULES.md`): OK. No non-null assertions, no sensitive-data logging, no gRPC decorator concerns (pure service unit test). "Logging: minimal" matches the "keep logs lean" rule.
- **Roadmap** (`.ai-factory/ROADMAP.md`): Not checked into review scope; this is a test-only task with no feature/roadmap linkage required.
- **Skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): Not present — no project-specific overrides to apply.

## Verification Against Codebase

All plan assumptions were confirmed against the real source:

- **Service path & methods** — `src/nfb-calibration/nfb-calibration.service.ts` exists with exactly two methods, `record()` and `list()`. ✓
- **Mock repo surface** — `record()` uses `repo.create` + `repo.save`; `list()` uses `repo.findAndCount`. The proposed factory `{ create, save, findAndCount }` covers all used methods. ✓
- **Spec file absent** — `nfb-calibration.service.spec.ts` does not yet exist. ✓
- **Pattern reference** — `src/bci/bci-device.service.spec.ts` uses `new BciDeviceService(repo as any)` with a `makeRepo()`/`makeX()` helper structure; the plan's direct-instantiation guidance matches. ✓
- **Imports** — `RpcException` (`@nestjs/microservices`) and `status as GrpcStatus` (`@grpc/grpc-js`) are exactly what the service imports. ✓
- **Request interface** — `RecordNfbCalibrationRequest` in `proto/generated/nfb_calibration` is a flat interface containing every field the plan lists. ✓

### Test cases match actual behavior

- **failReason** — code is `req.failReason || null`, so empty string → `null`, undefined → `null`, non-empty preserved. All three Phase 2 cases are correct.
- **Invalid timestamp** — `new Date(req.calibratedAt)` + `Number.isNaN(getTime())` throws `RpcException({ code: INVALID_ARGUMENT, message: 'Invalid calibratedAt timestamp' })` before any `create`/`save`. Phase 3 cases (including the "no create/save" assertions) are accurate.
- **where clause** — `if (deviceSerial && deviceSerial.length > 0)` correctly yields the undefined / empty-string / non-empty / single-char distinctions in Phase 4.
- **take/skip** — `Math.min(limit && limit > 0 ? limit : 50, 200)` and `skip: offset` (with defaults `limit = 50`, `offset = 0`) back every Phase 5 case: 0/negative/omitted → 50, >200 → 200, in-range passthrough, offset → skip. ✓
- **order** — `order: { createdAt: 'DESC' }` matches the "order by createdAt DESC" case. ✓
- **Result passthrough** — `list()` returns the `findAndCount` tuple directly and does not catch, so the tuple/empty/reject cases in Phase 6 hold. ✓

## Minor Notes (non-blocking)

- The proto `RecordNfbCalibrationRequest.failReason` is typed as a required `string`, not optional. The "undefined failReason" case (Task 2) is still valid because the test builds the request via a mock helper and casts (`as any` / `Partial` override), exercising the runtime `|| null` branch. The implementer should construct that one case by omitting the field rather than relying on the proto type allowing `undefined`.
- `makeReq(overrides)` should include `individualPeakFrequency` (nullable in the entity but a plain `number` in the proto request) so the "passes all fields through to repo.create" assertion can compare the full mapped object.

## Positive Notes

- Method-by-method, phase-per-concern decomposition is clean and maps 1:1 to the two branches and the guard in the service.
- Concrete implementer guidance (instantiation pattern, exact mock surface, exact field list, exact exception imports) removes guesswork.
- Edge cases for the `take` clamp (0, negative, omitted, >200, in-range) and the `deviceSerial` guard (undefined, empty, single-char, non-empty) are thorough and match the real boundary logic.

PLAN_REVIEW_PASS
