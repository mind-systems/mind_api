# Plan: Honor `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=0` in `src/main.ts`

## Context
Make an explicit `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=0` env value actually disable the flag by replacing the falsy-coercing `Number(x) || default` idiom with a NaN-checked parse, applied consistently to all three keepalive env reads.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Fix env parsing

- [x] **Task 1: Add a NaN-checked numeric env parse helper**
  Files: `src/main.ts`
  Inside `bootstrap()` (or as a small module-scope function above it), add a tiny helper that parses a numeric env var and falls back to a default only when the value is absent or not finite — so an explicit `0` is honored. Example shape:
  ```ts
  const numEnv = (v: string | undefined, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  ```
  Note: `Number(undefined)` is `NaN` and `Number('')` is `0`; if treating empty string as "unset" matters, guard with `v == null || v === '' ? def : ...`. Keep the helper local to `main.ts` — do not export or move to a shared util.

- [x] **Task 2: Apply the helper to the three keepalive reads** (depends on Task 1)
  Files: `src/main.ts`
  Replace the current reads (lines ~82-86):
  ```ts
  const keepaliveTimeMs = Number(process.env.GRPC_KEEPALIVE_TIME_MS) || 30_000;
  const keepaliveTimeoutMs = Number(process.env.GRPC_KEEPALIVE_TIMEOUT_MS) || 10_000;
  const keepalivePermitWithoutCalls = Number(process.env.GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS) || 1;
  ```
  with the helper-based form, preserving the exact same defaults (`30_000`, `10_000`, `1`):
  ```ts
  const keepaliveTimeMs = numEnv(process.env.GRPC_KEEPALIVE_TIME_MS, 30_000);
  const keepaliveTimeoutMs = numEnv(process.env.GRPC_KEEPALIVE_TIMEOUT_MS, 10_000);
  const keepalivePermitWithoutCalls = numEnv(process.env.GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS, 1);
  ```
  Guards: defaults unchanged; do NOT alter the `keepalive` / `channelOptions` block shape or any other code; transport-only change with no behavior difference unless an env var is explicitly set to `0`.

- [x] **Task 3: Verify the build compiles** (depends on Task 2)
  Files: `src/main.ts`
  Run `npm run build` and confirm `main.ts` compiles cleanly. Pre-existing unrelated `tsc` errors in `biometric-stream-engine.service.spec.ts` (noted in the spec) are out of scope — do not fix them.
