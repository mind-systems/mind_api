# Code Review: Enable server keepalive on the gRPC microservice in `src/main.ts`

**Scope reviewed:** `git diff HEAD` — `src/main.ts`, `.env`, `.env.dev`, `.env.prod` (plus `.ai-factory/` plan/review artifacts, non-code).
**Risk Level:** 🟢 Low

## Summary

The change is correct, minimal, and matches the plan exactly. It adds env-driven
HTTP/2 keepalive options to the single gRPC microservice bootstrap so the server
PINGs idle/half-open peers and reaps dead connections, allowing the existing
disconnect → grace → abandon machinery to fire. Transport-only: no proto, DB, or
migration change. I verified the change actually takes effect at runtime (it is not
a silent no-op) and that the env wiring is consistent across all three env files.

## Verification performed

- **NestJS actually consumes the camelCase `keepalive` block.** Confirmed in
  `node_modules/@nestjs/microservices/server/server-grpc.js:75-92`: `getKeepaliveOptions()`
  maps `keepaliveTimeMs → grpc.keepalive_time_ms`, `keepaliveTimeoutMs → grpc.keepalive_timeout_ms`,
  `keepalivePermitWithoutCalls → grpc.keepalive_permit_without_calls`, and at lines 420-423
  merges them into the channel options (`{ ...channelOptions, ...keepaliveOptions }`) used to
  create the server. So the block is effective, not decorative. ✅
- **No channel-arg key collision.** Our `channelOptions` sets only
  `grpc.http2.min_ping_interval_without_data_ms`; the translated keepalive block sets only the
  three `grpc.keepalive_*` keys. Disjoint — the spread merge has nothing to clobber. ✅
- **Typed against the interface.** `keepalive` and `channelOptions` are valid siblings on
  `GrpcOptions.options` (`@nestjs/microservices/interfaces/microservice-configuration.interface.d.ts:40-49`),
  so this compiles under the existing `MicroserviceOptions` generic. ✅
- **`process.env`-before-`ConfigModule` is the established pattern.** The three new reads sit
  next to the existing `GRPC_URL` / `LOG_*` reads in `bootstrap()` and follow the same style.
  Correct — `ConfigService` is not available this early, and the plan explicitly (and rightly)
  keeps these out of `RealtimeConfig` (that set is `WS_*`). ✅
- **Defensive parsing is sound for the time values.** `Number(undefined)` → `NaN` → `|| default`;
  `Number('')` → `0` → `|| default`; `Number('30000')` → `30000`; `Number('30abc')` → `NaN` →
  default. No `NaN` can reach the gRPC layer. ✅
- **RULES compliance.** No non-null assertion (`!`), no new logging, no PII. ✅
- **Env files consistent.** `.env`, `.env.dev`, `.env.prod` all gained the same three keys with
  matching default values under the `# gRPC` section. ✅

## Findings

None blocking.

### Nit (non-blocking, already acknowledged in plan review)

- **`GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS` cannot be set to `0` via env.**
  `Number(process.env.GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS) || 1` collapses a legitimate `0`
  (the only alternative value — "do not ping when no calls are active") back to `1`. For the two
  time values `0` is never a sensible input, so `|| default` is fine there; only this boolean-style
  flag is affected. Practical impact is negligible — the realtime streams are long-lived so calls
  are virtually always active, and `1` is the intended default anyway. If true tunability is ever
  wanted, switch this one read to a `NaN`-only fallback, e.g.
  `const n = Number(process.env.GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS); keepalivePermitWithoutCalls = Number.isFinite(n) ? n : 1;`.
  Not required for this change.

## Positive notes

- Single block covers all tunnels (control/instruction/biometric/sync) — keepalive is a
  channel-level property, correctly applied once at the server, with no per-controller changes.
- The `min_ping_interval_without_data_ms: 25_000` guard (below the 30s ping cadence) correctly
  prevents a strict client from replying `GOAWAY ENHANCE_YOUR_CALM`; reconciled against the mobile
  Dart `grpc` 5.1.0 client tolerance per note 51 — no mobile change required.
- Env defaults mirror the code defaults exactly, so behavior is identical whether or not an
  operator sets the keys.

REVIEW_PASS
