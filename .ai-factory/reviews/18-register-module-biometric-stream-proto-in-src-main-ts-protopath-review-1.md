# Code Review — Phase 18: Register `module_biometric_stream.proto` in `src/main.ts`

## Scope of change

`git diff HEAD` shows a single functional code change:

```
src/main.ts:
+        join(process.cwd(), 'proto', 'module_biometric_stream.proto'),
```

appended as the last entry of the `protoPath` array inside the
`app.connectMicroservice<MicroserviceOptions>({...})` block. No other source
files were modified. The remaining staged paths are plan/plan-review
documentation under `.ai-factory/`.

## Verification

- `proto/module_biometric_stream.proto` exists on disk and declares
  `package mind;` (line 3), matching the existing `package: 'mind'` in
  `src/main.ts:59`. No package-mismatch risk.
- The proto imports `module_state.proto` (line 6). That dependency is
  already registered in the `protoPath` array (`src/main.ts:64`), so the
  loader will resolve `StateErrorEvent` without issue.
- The new entry preserves the surrounding style exactly: same
  `join(process.cwd(), 'proto', '<name>.proto')` form, same indentation,
  trailing comma maintained.
- `join` and `process.cwd` are already imported / globally available — no
  new imports needed.
- Consumer side is present: `src/realtime/module-biometric-stream.grpc.controller.ts`
  uses `@ModuleBiometricStreamServiceControllerMethods()` from the generated
  stubs and is registered in `RealtimeModule`. Once the proto is loaded by
  the gRPC transport, the controller's `streamData` RPC will bind and the
  `UNIMPLEMENTED` regression disappears.
- No security implications: auth comes from `GrpcAuthInterceptor`/metadata
  (per `RULES.md`), not from the proto registration. The proto file itself
  defines only message shapes and the service signature.
- No migrations, env vars, or DI changes are touched. No runtime ordering
  concerns: the array is consumed once at bootstrap before
  `startAllMicroservices()`.

## Risk surface

- **Runtime:** none. Adding a proto to `protoPath` is purely additive — it
  loads an additional service definition and binds matching controllers.
  Existing services are unaffected.
- **Type safety:** the controller already imports types from the generated
  stubs, which are produced at build time independently of `protoPath`.
- **Concurrency/race:** none — bootstrap path.
- **Backwards compatibility:** none broken; this is the inverse — it
  unbreaks a service that was silently missing.

## Findings

None.

REVIEW_PASS
