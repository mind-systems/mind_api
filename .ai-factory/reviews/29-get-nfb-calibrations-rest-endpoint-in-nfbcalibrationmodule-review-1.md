# Code Review: GET /nfb-calibrations REST endpoint in NfbCalibrationModule

**Plan:** `.ai-factory/plans/29-get-nfb-calibrations-rest-endpoint-in-nfbcalibrationmodule.md`
**Scope reviewed:** all staged changes — `nfb-calibration.service.ts`, `nfb-calibration.grpc.controller.ts`, `nfb-calibration.module.ts`, `nfb-calibration.rest.controller.ts`, `dto/list-nfb-calibrations-query.dto.ts`.

## Summary

Implementation matches the plan exactly, including the two contract guards added during plan review 2:

- **`limit = 0` proto semantics preserved** — `nfb-calibration.service.ts:42` computes `const take = Math.min(limit && limit > 0 ? limit : 50, 200);`. Trace:
  - REST `undefined` → `take = 50`
  - gRPC `0` → `take = 50` (would have been `take: 0` with the spec's blind-spot version)
  - any `> 200` → clamped to 200
- **Empty `deviceSerial` skip-filter** — service guard at `nfb-calibration.service.ts:39` checks `deviceSerial && deviceSerial.length > 0`. gRPC empty-string semantic change is documented in plan, accepted, and confirmed harmless against `mind_mobile/lib/Bci/NfbCalibrationGrpcApi.dart:28` which always sends a real serial.
- **Tuple return** — service returns `[records, total]` via `findAndCount`. gRPC controller destructures `const [records] = ...` (drops `total`, keeping the proto response schema unchanged at `nfb-calibration.grpc.controller.ts:49-55`). REST returns `{ records, total }`.

## Correctness Walkthrough

### Service (`nfb-calibration.service.ts`)
- `FindOptionsWhere<NfbCalibrationRecord>` typed correctly; mutated to add `deviceSerial` only when non-empty — no TypeORM "where: empty object" pitfall (root `where` always carries `userId`).
- `skip: offset` and `take` both passed through `findAndCount` — count is computed under the same WHERE, so `total` reflects post-filter row count (correct).
- Default parameters (`limit = 50`, `offset = 0`) are belt-and-braces — the `limit > 0` guard makes the `= 50` default redundant but harmless. `offset = 0` is the actual default for `undefined` from REST.

### gRPC controller (`nfb-calibration.grpc.controller.ts:49-54`)
- Call site updated to four args: `user.sub`, `request.deviceSerial`, `request.limit`, `0`.
- Hard-coded `0` for offset is correct: the proto has no `offset` field, so gRPC callers always page from the start.
- `request.deviceSerial` (always present as string from proto, possibly `""`) is passed through. Service's empty-string guard makes the behavior "all caller's devices" when empty — accepted per plan.
- Response shape unchanged: `{ records: records.map(toProtoNfbCalibrationRecord) }`. `total` is intentionally dropped because `ListNfbCalibrationsResponse` (proto-generated) has no such field.

### REST controller (`nfb-calibration.rest.controller.ts`)
- `@Controller('nfb-calibrations')` + `@Get()` resolves to `GET /nfb-calibrations`. Route is unique — verified no other controller uses the path.
- `@UseGuards(JwtAuthGuard)` correctly applied at the controller level. `JwtAuthGuard` is provided by `AuthModule` (`src/users/auth.module.ts:53-62`) and `AuthModule` is in `NfbCalibrationModule.imports` (verified).
- `@CurrentUser()` returns `request.user` populated by the guard — guard sets `request.user = payload` *before* the parameter decorator resolves, so `user.sub` is always defined at handler entry.
- `JwtPayload` imported with `import type` — correct for the type-only usage at the param annotation.
- Handler is thin (matches architecture rule "controllers are thin"); all logic in the service.

### Query DTO (`dto/list-nfb-calibrations-query.dto.ts`)
- `deviceSerial?: string` — `@IsString()` + `@IsOptional()`. `@IsOptional()` short-circuits `@IsString()` when undefined; non-string query strings (Express always parses query as strings or arrays, never numbers) won't be supplied here.
- `limit` — `@Type(() => Number)` correctly coerces the query string before `@IsInt()` validates. `@Min(1) @Max(200)` rejects 0 and out-of-range values *at the REST layer*; the service's `limit > 0` guard is a second line of defense for gRPC (where DTO validation doesn't run).
- `offset` — `@Type(() => Number) @IsInt() @Min(0)` — same coercion pattern; `offset = 0` allowed.
- Pattern matches `src/sessions/dto/list-runs-query.dto.ts` precedent.

### Module wiring (`nfb-calibration.module.ts:11`)
- `NfbCalibrationRestController` added to `controllers` alongside `NfbCalibrationGrpcController`. `AuthModule` already imported. `NfbCalibrationModule` already registered in `AppModule.imports` (`src/app.module.ts:37`). No additional wiring needed.

## Runtime-break Checks

- **Migrations:** none required — the `nfb_calibration_records` table already exists (Milestone 19). No schema delta.
- **Type mismatches:** `findAndCount` returns `[Entity[], number]` which matches the declared `Promise<[NfbCalibrationRecord[], number]>`. gRPC's `records.map(toProtoNfbCalibrationRecord)` still typechecks because `NfbCalibrationRecord[]` is the destructured first tuple element.
- **Race conditions:** read-only endpoint; no concurrency concerns.
- **Validation pipe:** global `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })` confirmed at `src/main.ts:79-85`. Query coercion (`@Type(() => Number)`) is wired correctly.
- **Auth-bypass / IDOR:** every query is filtered by `userId = user.sub`. There is no path param or body field that could be tampered with to reach another user's rows.
- **SQL injection / sort injection:** WHERE clause uses parameterized `FindOptionsWhere`; `order: { createdAt: 'DESC' }` is hard-coded. Safe.
- **Pagination correctness:** `Math.min(limit, 200)` cap is applied even when DTO `@Max(200)` already enforces it — defense in depth. `findAndCount` count is unaffected by `take`/`skip`, so `total` is the full-result count (correct for paging metadata).

## Findings

### Non-blocking observations

1. **`limit = 50` default parameter is redundant.** With the `limit && limit > 0 ? limit : 50` guard, the `limit = 50` default in the signature is never the deciding branch — but keeping it documents intent and improves the signature's self-description. No change requested.
2. **Entity returned directly on the wire.** REST `records` returns the raw `NfbCalibrationRecord` entity, including `userId` (always the caller's own id, so not a privacy issue). This is explicitly accepted in the plan and matches the `src/sessions/sessions.controller.ts` precedent. No DTO mapper added.
3. **Proto comment drift (pre-existing).** `proto/nfb_calibration.proto` does not document that `device_serial = ""` now means "all devices". The behavior change is documented in the plan and Commit 1 body, but a future proto reader will not know. This is a doc-only follow-up, not a code defect.
4. **`current-user.decorator.ts:7` uses `request.user!`** — violates RULES.md "Never use `!`". This file is **not** part of this change and is pre-existing across all REST controllers (`sessions.controller.ts`, `auth.rest.controller.ts`). Out of scope.

No correctness, security, or contract bugs found in the staged code.

REVIEW_PASS
