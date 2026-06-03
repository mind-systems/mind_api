# Bio Sample Timestamp — Number() Cast in Biometric Controller

**Date:** 2026-06-03
**Source:** conversation context — review of note 38 (web team's unauthorized fix)

## Key Findings

- `ModuleBiometricStreamGrpcController.handleBatch` maps `s.timestamp` into `BioSampleInternal` without a `Number()` cast. At runtime `@grpc/proto-loader` deserialises `int64` proto fields as Long objects (`{low, high, unsigned}`), not plain JS numbers. The JSONB column ends up storing the object instead of a number.
- The instruction-stream controller already handles this correctly: `timestamp: Number(msg.timestamp)` — the biometric controller must mirror it.
- No data migration needed: `bio_session_samples` has no production rows.

## Details

### File to change

`src/realtime/module-biometric-stream.grpc.controller.ts`, inside `handleBatch`:

```typescript
// Before
const mapped: BioSampleInternal[] = batch.samples.map((s) => ({
  timestamp: s.timestamp,
  sampleType: s.sampleType,
  data: s.data,
}));

// After
const mapped: BioSampleInternal[] = batch.samples.map((s) => ({
  timestamp: Number(s.timestamp),
  sampleType: s.sampleType,
  data: s.data,
}));
```

### Why Number() works

`Long.prototype.valueOf` is aliased to `Long.prototype.toNumber`, so `Number(longInstance)` returns the correct 53-bit-safe JS number. Bio sample timestamps are Unix-ms values well within the safe integer range.

### Reference

`src/realtime/module-instruction-stream.grpc.controller.ts` — identical cast already in place; this change aligns the two controllers.

### How to verify

Start a meditation or breath session, emit biometric samples, inspect a row in `bio_session_samples`: `samples[*].timestamp` must be a JSON number, not `{"low":…,"high":…}`.
