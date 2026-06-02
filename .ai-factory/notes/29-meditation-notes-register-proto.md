# Meditation Notes — Register Proto in main.ts

**Date:** 2026-06-02
**Source:** conversation context

## Key Findings

- `meditation_notes.proto` must be added to the `protoPath` array in `src/main.ts` or `MeditationNotesService` will never load.
- Omitting this causes silent `UNIMPLEMENTED` errors at runtime — no startup warning.
- One-line change; same pattern as all other proto registrations (bci_devices, nfb_calibration, module_biometric_stream).

## Details

### Change in `src/main.ts`

Find the `protoPath` array (currently lists bci_devices, nfb_calibration, module_biometric_stream, etc.) and append:

```typescript
join(process.cwd(), 'proto', 'meditation_notes.proto'),
```

### Why this is a separate milestone

Every proto file in this project has had its own "register in main.ts" step because it's the single most common omission that causes runtime failures. Keeping it explicit ensures it isn't skipped under time pressure.

## How to verify

Start the server (`make up`). Call `MeditationNotesService/CreateOrUpdateNote` via grpcurl. Response should be `UNAUTHENTICATED` (not `UNIMPLEMENTED`), confirming the service is registered.
