# Plan: Register `meditation_poses.proto` in `src/main.ts` protoPath

## Context
Ensure `meditation_poses.proto` is listed in the gRPC `protoPath` array in `src/main.ts` so `MeditationPosesService` is bound at startup and mobile clients no longer hit `UNIMPLEMENTED` at runtime.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Register and verify

- [x] **Task 1: Confirm/append `meditation_poses.proto` in `protoPath`**
  Files: `src/main.ts`
  In the `app.connectMicroservice` options, locate the `protoPath` array (around line 60-74). Ensure it contains the entry `join(process.cwd(), 'proto', 'meditation_poses.proto'),` alongside the existing entries (`meditation_notes.proto`, `nfb_calibration.proto`, `bci_devices.proto`, etc.). **Note:** at the time of planning this entry is already present at line 73 — if so, no edit is needed; do not duplicate it. Only add the line if it is missing.

- [x] **Task 2: Verify the service binds at startup** (depends on Task 1)
  Files: `src/main.ts`, `proto/meditation_poses.proto`, `src/meditation-poses/meditation-poses.module.ts`
  Confirm the supporting pieces are wired: `proto/meditation_poses.proto` exists, `MeditationPosesModule` is imported in `src/app.module.ts`, and `meditation-poses.grpc.controller.ts` exposes the gRPC handlers. Start the server (`npm run start:dev` or `make up`) and confirm `MeditationPosesService` appears in the NestJS gRPC binding log with no `UNIMPLEMENTED` mapping warnings. Confirm `npm run build` compiles cleanly.
