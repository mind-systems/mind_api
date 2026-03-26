# Code Review — Plan #28: Rename `/live` → `module_session`, `/telemetry` → `module_stream`

**Files changed:** 15 (2 proto, 1 proto comment, 2 generated stubs, 2 controllers, main.ts, module, 7 docs, plan)
**Build:** `tsc --noEmit` passes
**Tests:** 119/120 pass — 1 failure is pre-existing in `auth.service.spec.ts` (Google OAuth, unrelated to this change)

---

## Issues

### 1. `telemetry-model.md` — `/biometric` incorrectly replaced with `module_stream`

**File:** `docs/socket/telemetry-model.md`, line 109
**Severity:** Medium — changes documented architectural intent

The original text:
> Биометрические потоки будут идти через **отдельный namespace `/biometric`** и отдельную таблицу

Was changed to:
> Биометрические потоки будут идти через **отдельный сервис `module_stream`** и отдельную таблицу

`/biometric` was a **planned future** service for biometric data (EEG, breathing belt), distinct from the current telemetry stream. Replacing it with `module_stream` says biometrics will use the same service that already handles breath phase samples — collapsing the original architectural vision of a dedicated biometric service into the existing telemetry one.

**Fix:** Either leave the original future service name (e.g., `module_biometric`) or reword to preserve the "separate service" intent. For example:
```
Биометрические потоки будут идти через отдельный gRPC-сервис и отдельную таблицу
```

---

## Observations (non-blocking)

### 2. `overview.md` changes go beyond name substitution (positive)

The plan specified "replace namespace and class references only" for Task 9, but `overview.md` also rewrote the Transport Layer auth description (Socket.IO middleware → gRPC interceptor) and updated the module component list (removed `WsAuthMiddleware`, `WsRateLimitGuard`, `WsExceptionFilter`; added `GrpcAuthInterceptor`). This is more accurate and a good change — just noting it exceeds the stated scope.

### 3. Pre-existing stale references in docs: `WsRateLimitGuard`, `WsExceptionFilter`

These Socket.IO-era names appear in 4 locations across `protocol.md`, `configuration.md`, and `overview.md`, but these components no longer exist in the codebase. This was true **before** this changeset and is not a regression. Could be cleaned up in a separate pass.

---

## Verified Correct

- **Proto contracts:** Field numbers preserved. Domain messages (`ActivityStartCmd`, `SessionStateEvent`, etc.) untouched. Service names, RPC names, and message wrappers all renamed consistently.
- **Generated stubs:** `module_session.ts` and `module_stream.ts` present; stale `live.ts` and `telemetry.ts` deleted. All exported symbols match controller imports.
- **Controller method names:** `sessionStream` matches `ModuleSessionServiceController` interface and `grpcStreamMethods` decorator array. `streamData` matches `ModuleStreamServiceController` interface. Both verified against generated stubs.
- **gRPC routing paths:** `/mind.ModuleSessionService/SessionStream` and `/mind.ModuleStreamService/StreamData` — correct.
- **`main.ts` protoPath array:** Points to `module_session.proto` and `module_stream.proto` — correct.
- **`realtime.module.ts`:** Imports and controller array updated — correct.
- **`sync.proto` comment:** Updated to reference new file names — correct.
- **Line 81 `telemetry.proto` filename comment:** Updated to `module_stream.proto` — correct.
- **Doc namespace references:** All `/live` → `module_session`, all `/telemetry` → `module_stream`, all `LiveGateway` → `ModuleSessionGrpcController`, all `TelemetryGateway` → `ModuleStreamGrpcController`. Grep confirms zero remaining old references in `docs/`.
- **Domain entity `LiveSession`:** Correctly untouched throughout `src/`.
- **No old generated stubs or proto files left behind.**
