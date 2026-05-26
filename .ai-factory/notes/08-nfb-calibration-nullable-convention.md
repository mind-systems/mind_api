# NFB Calibration — `fail_reason` Nullable Convention

**Date:** 2026-05-28
**Status:** decision locked, applied to Phase 20 roadmap tasks

## Question

The `nfb_calibration_records` table has a `fail_reason` column that is only meaningful when `is_valid = false`. For valid calibrations the field has no value. Two options: `varchar NOT NULL` with empty string sentinel, or `varchar DEFAULT NULL` with `string | null`.

## Decision: nullable

**DB:** `fail_reason varchar DEFAULT NULL`
**Entity:** `@Column({ type: 'varchar', nullable: true }) failReason: string | null`

## Why

Codebase-wide audit (all entities under `src/`): zero uses of NOT NULL varchar with empty string as "absent" marker. Every conditionally-present string/date/enum field uses `nullable: true` + TypeScript union type `T | null`. Canonical examples:

- `Device.model` / `Device.manufacturer` — `varchar DEFAULT NULL`, `string | null`
- `ModuleSession.activityRefId` — `uuid nullable`, `string | undefined`
- `BreathSession.timeOfDay` — `enum nullable`, `TimeOfDay | null`

Empty string convention would be a one-off departure from the project standard and forces callers to distinguish `""` (no reason) from a real reason string.

## Proto ↔ DB mapping

Proto3 `string` fields default to `""` when not set — there is no null in proto3.

| Direction | Mapping |
|---|---|
| proto → DB (service `record()`) | `req.failReason \|\| null` — empty string becomes `null` |
| DB → proto (controller entity map) | `entity.failReason ?? ''` — `null` becomes empty string |

This mapping lives in the service (`record`) and controller (entity → proto response). Do not let `null` escape into the proto message or `""` leak into the DB.
