# Plan: Register `module_biometric_stream.proto` in `src/main.ts` protoPath

## Context
The `module_biometric_stream.proto` file exists in `proto/` but is not registered in the gRPC microservice `protoPath` array in `src/main.ts`. Without registration, `ModuleBiometricStreamService` silently fails to load and the mobile client receives `UNIMPLEMENTED` at runtime — the same regression that hit `bci_devices.proto` during Phase 16.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto registration

- [x] **Task 1: Append `module_biometric_stream.proto` to the gRPC `protoPath` array**
  Files: `src/main.ts`
  In the `app.connectMicroservice<MicroserviceOptions>({...})` block around line 60, extend the `protoPath` array with one additional entry: `join(process.cwd(), 'proto', 'module_biometric_stream.proto')`. Follow the exact style of the existing entries (same `join(process.cwd(), 'proto', '<file>.proto')` form). Place it as the last item in the array, after the existing `bci_devices.proto` entry, preserving the trailing comma convention used by the surrounding lines. Do not modify any other configuration (`package`, `url`, `transport`) and do not touch any other file.

<!-- orchestrator-sessions
planner: 570ab796-411a-4577-ba5e-de89d0ee225d
elapsed: 192
implementer: f0b7902e-11d0-4546-94ad-19a3628655dc
-->
