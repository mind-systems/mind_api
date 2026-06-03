# Bio Sample Timestamp Bug — Long Object vs Number

**Date:** 2026-06-03
**Source:** debugging session — web dashboard showed "No data" for all biometric sessions

## What Was Wrong

`GET /sessions/runs/:id/biometrics` was returning an empty array for every session even though `bio_session_samples` contained rows with real data.

Root cause: `sessions.service.ts` (`listBiometrics`) checks `typeof sample['timestamp'] === 'number'` before including a sample in the result. The check always failed because the timestamps in the DB were stored as protobuf Long objects `{"low": -1928538224, "high": 414, "unsigned": false}`, not as plain JS numbers.

## Why Timestamps Were Stored as Long Objects

`@grpc/proto-loader` decodes `int64` proto fields as Long objects (from the `long` npm package) by default, not as plain JS numbers. The instruction-stream gRPC controller handled this correctly with an explicit cast:

```typescript
// module-instruction-stream.grpc.controller.ts
timestamp: Number(msg.timestamp),
```

The biometric-stream gRPC controller did not:

```typescript
// module-biometric-stream.grpc.controller.ts — before fix
timestamp: s.timestamp,  // stored the Long object as-is
```

`JSON.stringify` on a Long object serialises its enumerable own properties — `low`, `high`, `unsigned` — so the JSONB column ended up with `{"low": ..., "high": ..., "unsigned": ...}` for every bio sample timestamp.

## What Was Changed

### `src/sessions/sessions.service.ts`

Added a helper `toUnixMs(raw)` that handles both formats:
- plain `number` → returned as-is
- Long object `{low, high}` → converted via `(high >>> 0) * 4294967296 + (low >>> 0)`
- anything else → `undefined` (sample is skipped, same defensive behaviour as before)

`listBiometrics` now uses `toUnixMs` instead of the raw `typeof === 'number'` check. When the Long format is detected, the normalised plain-number timestamp is written into the pushed sample so the client always receives a JSON number and the sort at the end does not produce NaN.

This fixes all existing rows in the DB without any data migration.

### `src/realtime/module-biometric-stream.grpc.controller.ts`

Added `Number()` cast when mapping the proto sample into `BioSampleInternal`, matching what the instruction-stream controller already does:

```typescript
// after fix
timestamp: Number(s.timestamp),
```

**This change was not necessary to fix the display bug** — `toUnixMs` in the service handles both formats. It was applied as a cleanup so new rows are stored with plain-number timestamps consistent with the instruction-stream. The existing data in the DB is unaffected; `toUnixMs` continues to handle it.

## Data in the DB

Confirmed via psql: all rows in `bio_session_samples` written before this fix have Long-format timestamps. `toUnixMs` converts them correctly — verified against `to_timestamp()` in PostgreSQL, values matched June 2026 session times.

## Unresolved / Watch Out

- The `Number()` cast on a Long from the `long` library works because `Long.prototype.valueOf` is aliased to `Long.prototype.toNumber`. If the gRPC library ever stops using `long` internally, the cast should be revisited.
- The instruction-stream (`session_stream_samples`) is unaffected — it always stored plain numbers and its read path still uses the original `typeof === 'number'` check.
