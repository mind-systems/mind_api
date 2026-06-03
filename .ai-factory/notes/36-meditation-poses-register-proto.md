# Meditation Poses — Register Proto in main.ts

**Date:** 2026-06-03
**Source:** conversation context

## Key Findings

- Without this change `MeditationPosesService` never loads and mobile gets `UNIMPLEMENTED` at runtime — no startup error surfaces.
- Same trap as `bci_devices.proto` (Phase 16) and `module_biometric_stream.proto` (Phase 19).
- One-line change in `src/main.ts`.

## Details

### Change

In `src/main.ts`, find the `protoPath` array (around line 60) and append:

```typescript
join(process.cwd(), 'proto', 'meditation_poses.proto'),
```

alongside existing entries (`bci_devices.proto`, `nfb_calibration.proto`, `meditation_notes.proto`, etc.).

### How to verify

Start the server (`make up` or `npm run start:dev`). `MeditationPosesService` appears in the NestJS gRPC binding log. A gRPC client call to `ListPoses` returns data instead of `UNIMPLEMENTED`.
