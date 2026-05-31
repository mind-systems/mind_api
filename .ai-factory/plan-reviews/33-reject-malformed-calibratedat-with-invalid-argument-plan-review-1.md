# Plan Review: Reject malformed `calibratedAt` with `INVALID_ARGUMENT`

**Plan:** `33-reject-malformed-calibratedat-with-invalid-argument.md`
**Risk Level:** 🟢 Low

## Verification Against Codebase

All assumptions in the plan were checked against the actual source:

- **Target file exists** — `src/nfb-calibration/nfb-calibration.service.ts` contains `record(...)` with `calibratedAt: new Date(req.calibratedAt)` on line 21, exactly as the plan describes.
- **Proto field type confirmed** — `RecordNfbCalibrationRequest.calibratedAt` is a `string` (ISO-8601) in `proto/generated/nfb_calibration.ts`. The protobuf default is `""`, which `new Date("")` turns into an `Invalid Date` (`NaN` time) — so the guard also catches the empty/unset case. Correct.
- **Entity column confirmed** — `nfb-calibration-record.entity.ts` declares `calibrated_at` as a non-nullable `timestamptz` (`type: 'timestamptz'`, no `nullable: true`). This is precisely the `NOT NULL timestamptz` insert that would otherwise raise `QueryFailedError`. The motivation is real.
- **Reference pattern confirmed** — `src/bci/bci-device.service.ts` already imports `RpcException` from `@nestjs/microservices` and `status as GrpcStatus` from `@grpc/grpc-js`, and throws `RpcException({ code: GrpcStatus.* , message })`. The plan mirrors an established, working in-repo convention, so the gRPC exception-mapping infrastructure is known to handle this shape.

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** No boundary violation. Change stays inside the `nfb-calibration` module's service layer; "controllers are thin, services hold logic" is respected. WARN: none.
- **Rules (`RULES.md`):** Validation-in-service with `RpcException`/`INVALID_ARGUMENT` matches the existing pattern. No convention conflict observed. WARN: none.
- **Roadmap (`ROADMAP.md`):** This is a small hardening `fix`. Worth linking to the relevant nfb-calibration milestone entry if one exists, but absence is non-blocking. WARN (non-blocking): roadmap linkage not stated in the plan.

## Observations (non-blocking)

- **No migration required** — confirmed. This is validation-only; the entity/schema is unchanged. The plan correctly omits a migration step.
- **Testing disabled by plan settings** (`Testing: no`). Acceptable given the scope, though a single spec asserting `INVALID_ARGUMENT` on `calibratedAt = ""` / `"garbage"` would lock in the behavior cheaply. Not a blocker.
- **Logging minimal** — the plan adds no log line for the rejected timestamp, consistent with the `Logging: minimal` setting and with `bci-device.service.ts`, which also throws without logging. Consistent.
- **No re-parse** — the plan correctly instructs reusing the validated `calibratedAt` local in the `repo.create(...)` call rather than calling `new Date(req.calibratedAt)` a second time. Good; avoids divergence.

## Critical Issues

None.

## Positive Notes

- The plan reuses an existing, verified in-repo pattern rather than inventing a new error-handling style — imports, exception class, and status enum all match `bci-device.service.ts` exactly.
- Single-responsibility, minimal-surface change: one guard at the top of `record`, plus reuse of the parsed value. No collateral edits.
- Edge case (empty proto default `""`) is implicitly covered by the `Number.isNaN(getTime())` check.

PLAN_REVIEW_PASS
