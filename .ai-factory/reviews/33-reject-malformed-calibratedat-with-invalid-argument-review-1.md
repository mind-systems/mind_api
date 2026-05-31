# Code Review: Reject malformed `calibratedAt` with `INVALID_ARGUMENT`

**Plan:** `33-reject-malformed-calibratedat-with-invalid-argument.md`
**Reviewed file:** `src/nfb-calibration/nfb-calibration.service.ts`

## Scope of changes
- Added imports of `RpcException` (`@nestjs/microservices`) and `status as GrpcStatus` (`@grpc/grpc-js`).
- Added a guard at the top of `record` that parses `req.calibratedAt` once into a `calibratedAt` local, throwing `RpcException` with `INVALID_ARGUMENT` when `Number.isNaN(calibratedAt.getTime())`.
- Reused the validated `calibratedAt` local in `repo.create(...)` instead of re-parsing.

## Verification

- **Matches the plan exactly.** The diff is identical to the spec/plan — no collateral edits, no scope creep.
- **Guard logic is correct.** `new Date('')` and `new Date('garbage')` both yield `Invalid Date`, whose `getTime()` is `NaN`, so the proto3 empty-string default (`''`) and any malformed value are both rejected before the insert. Valid ISO-8601 strings pass through unchanged.
- **No re-parse divergence.** The entity is built from the same validated `Date` instance — no second `new Date(...)` call.
- **Error mapping is sound for the actual caller.** `record` is invoked only from `nfb-calibration.grpc.controller.ts` (confirmed by grep — the REST controller calls only `list`). Over gRPC, `RpcException` is mapped to the wire `INVALID_ARGUMENT` status correctly. The spec's "future REST POST" reuse is hypothetical and not present, so no `RpcException`-over-HTTP mismatch exists today.
- **Pattern consistency.** Imports, exception class, and status enum mirror `src/bci/bci-device.service.ts` exactly — an established, working convention.
- **No migration / schema / proto impact.** Validation-only change; entity and column are untouched.
- **No type issues.** `calibratedAt` is a `Date`, matching the entity's `timestamptz` column mapping; `req.calibratedAt` is typed `string` in the generated proto stub.

## Findings
None.

REVIEW_PASS
