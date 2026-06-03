# Plan: Register `meditation_notes.proto` in `src/main.ts` protoPath

## Context
Ensure `meditation_notes.proto` is registered in the gRPC `protoPath` array in `src/main.ts` so `MeditationNotesService` loads at startup and mobile calls do not fail with `UNIMPLEMENTED`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Current State (recon)
- `src/main.ts` line 72 **already contains** `join(process.cwd(), 'proto', 'meditation_notes.proto')` in the `protoPath` array.
- `proto/meditation_notes.proto` exists.
- `src/meditation-notes/` module exists (`MeditationNotesGrpcController` committed in `b669cf1`).

The core change requested by this milestone is already present. The remaining work is verification, not editing.

## Tasks

### Phase 1: Verify Registration

- [x] **Task 1: Confirm proto registration is present and correct**
  Files: `src/main.ts`
  Confirm the `protoPath` array inside the `connectMicroservice` gRPC options block contains exactly one entry `join(process.cwd(), 'proto', 'meditation_notes.proto')`, placed alongside the other proto registrations (after `nfb_calibration.proto`). It must follow the identical pattern used by sibling entries (`bci_devices.proto`, `module_biometric_stream.proto`, `nfb_calibration.proto`) — same `join(process.cwd(), 'proto', ...)` form and matching trailing comma. If the entry is missing (e.g. on a fresh branch), append it as the last element of the array. If a duplicate entry exists, remove the extra so the proto is listed only once.

- [x] **Task 2: Confirm the build compiles** (depends on Task 1)
  Files: `src/main.ts`
  Run `npm run build` to confirm `src/main.ts` compiles with no TypeScript errors after Task 1. No code changes expected unless the build surfaces an issue.
