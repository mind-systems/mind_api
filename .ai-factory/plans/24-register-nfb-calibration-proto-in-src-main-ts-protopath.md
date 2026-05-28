# Plan: Register `nfb_calibration.proto` in `src/main.ts` protoPath

## Context
Register `nfb_calibration.proto` in the gRPC microservice's `protoPath` array in `src/main.ts` so the NFB calibration service is loaded at startup; without it the mobile client receives `UNIMPLEMENTED` at runtime with no startup error.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Register proto

- [x] **Task 1: Append `nfb_calibration.proto` to protoPath array**
  Files: `src/main.ts`
  Append `join(process.cwd(), 'proto', 'nfb_calibration.proto')` as the last entry of the `protoPath` array at `src/main.ts:60` (after the existing `module_biometric_stream.proto` entry at line 70). Follow the same formatting and style as the surrounding `bci_devices.proto` entry added in Phase 16. Verify the file `proto/nfb_calibration.proto` already exists in the repo before adding.

<!-- orchestrator-sessions
planner: 8b32ae13-6ed6-4a41-8ac9-e25ca2eef975
elapsed: 202
implementer: 25cf35e7-e8ba-483f-ae92-981e73f565e1
-->
