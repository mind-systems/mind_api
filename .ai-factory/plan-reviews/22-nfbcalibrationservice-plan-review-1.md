# Plan Review: NfbCalibrationService

## Code Review Summary

**Files Reviewed:** 1 plan (`22-nfbcalibrationservice.md`)
**Risk Level:** 🟢 Low

### Context Gates

- **Architecture (`ARCHITECTURE.md`)** — OK. Modular monolith: `NfbCalibrationModule` owns the entity, `@InjectRepository(NfbCalibrationRecord)` is used only inside the module (already wired in `nfb-calibration.module.ts`). Service holds business logic, controller stays thin — matches the layer rules.
- **Rules (`RULES.md`)** — OK. No non-null assertion (`!`) usage proposed. No sensitive data in logs (no logging at all, per "logging: minimal"). The `@Payload()` / `@GrpcCurrentUser()` rule is a controller-level concern and is out of scope for this task.
- **Roadmap (`ROADMAP.md`)** — OK. Plan targets Phase 20 → task **"`NfbCalibrationService`"**. Matches roadmap line 71 verbatim (insert unconditionally, no upsert, `failReason || null`, `take(limit || 50)`, order by `created_at DESC`).

### Critical Issues

None — the plan is implementable as written and produces a working append-only history service.

### Minor Notes (non-blocking)

1. **`new Date(req.calibratedAt)` on empty string is `Invalid Date`** — proto3 default for `calibratedAt` is `""`. `new Date("")` yields an invalid `Date`, which TypeORM will pass to Postgres and fail with a confusing error. Mobile-app contract makes this practically impossible, and the milestone explicitly says "no extra error handling", so this is acceptable scope-wise — but worth a sentence in the plan acknowledging the field is treated as required by the client contract.

2. **Ordering column choice (`createdAt` vs `calibratedAt`)** — plan uses `createdAt: 'DESC'`. This is consistent with the ROADMAP entry ("ordered by `created_at DESC`") and is the safer choice (server-assigned, immune to client clock skew). No change needed; flagging only because the mobile note may casually read "newest first" as `calibratedAt`. The chosen column matches the entity field that has `@CreateDateColumn` and matches the migration's `created_at DEFAULT now()`. Good.

3. **`limit` upper bound not capped** — `take: limit || 50` will pass through any positive integer the caller supplies (e.g., `1_000_000`). Mobile is internal and trusted, so this is fine for now, but if external clients ever hit this RPC a `Math.min(limit || 50, 200)` would prevent runaway result sets. Out of scope for the milestone — note only.

4. **Return-type naming collision potential** — both the entity and the proto interface are named `NfbCalibrationRecord`. The plan correctly imports only `RecordNfbCalibrationRequest` from the generated proto (the existing entity import stays). This avoids a name clash in this file. The eventual controller (next roadmap task) will need to deal with it via `import type { NfbCalibrationRecord as NfbCalibrationRecordProto }` or a similar alias — not this plan's problem, but worth keeping in mind for the controller plan.

### Positive Notes

- Correct treatment of proto3 default-string ↔ DB-null convention (`req.failReason || null`).
- Correct handling of proto3 `int32` default-zero "server default" semantics (`limit || 50`).
- Explicitly says **do not** set `id` or `createdAt` — respects `@PrimaryGeneratedColumn('uuid')` and `@CreateDateColumn`.
- Verified the import path `../../proto/generated/nfb_calibration` against eight precedents in `src/` — correct.
- Verified the `RecordNfbCalibrationRequest` shape against `proto/generated/nfb_calibration.ts:40-52` — every field the plan maps onto the entity is present in the request type; no missing/extra fields.
- Verified entity columns against the migration (`1779993063433-AddNfbCalibrationRecordsTable.ts`) — column names, types (`double precision`), nullability, FK, and the `(user_id, device_serial)` index all line up.
- Verified the `BciDeviceService` reference style (`src/bci/bci-device.service.ts`) is a sensible model for repository access patterns at this layer.
- Append-only semantics match the migration (no unique constraint, no upsert) and match the architectural intent ("immutable record — never overwritten" from Phase 20 header).
- Scope discipline — plan stays inside the two methods and does not drift into controller/proto changes.

PLAN_REVIEW_PASS
