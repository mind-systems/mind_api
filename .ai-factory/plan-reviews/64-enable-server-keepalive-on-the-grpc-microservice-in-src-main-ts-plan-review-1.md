# Plan Review: Enable server keepalive on the gRPC microservice in `src/main.ts`

**Plan:** `64-enable-server-keepalive-on-the-grpc-microservice-in-src-main-ts.md`
**Risk Level:** 🟢 Low

## Summary

The plan is sound, tightly scoped, and well-grounded. Every factual claim it makes
was verified against the codebase and the supporting research note:

- **File path & line refs are correct.** `src/main.ts` bootstraps the gRPC microservice
  via `app.connectMicroservice<MicroserviceOptions>({ transport: Transport.GRPC, options: { url, package, protoPath } })`
  at lines 82–103, with no keepalive options today. ✅
- **The "runs before `ConfigModule`" assumption is correct.** `main.ts` already reads
  `LOG_DESTINATION`, `OTLP_ENDPOINT`, `LOG_LEVEL`, `GRPC_URL`, and the port straight from
  `process.env` with defaults (lines 22–27, 42, 81, 122). Adding three more `process.env`
  reads in the same style is consistent and correct. ✅
- **The typed `keepalive` block exists.** Confirmed in
  `node_modules/@nestjs/microservices/interfaces/microservice-configuration.interface.d.ts`:
  `GrpcOptions.options.keepalive` carries `keepaliveTimeMs`, `keepaliveTimeoutMs`,
  `keepalivePermitWithoutCalls` (plus `http2*` fields), and a sibling `channelOptions?: ChannelOptions`. ✅
- **RULES compliance.** The plan explicitly forbids the non-null assertion (`!`) per
  `.ai-factory/RULES.md`, and uses `Number(...) || default`. No new logging, no PII —
  compliant with the "keep logs lean" / "never log sensitive data" rules. ✅
- **Env files match.** `.env`, `.env.dev`, `.env.prod` each have a `# gRPC` section with
  `GRPC_URL` set (uncommented), so adding the three keys as set values is consistent. ✅
- **Scope is correct.** No proto / DB / migration change is needed — keepalive is a
  channel-level transport property on the single gRPC server, covering all tunnels. The note
  (`51-grpc-server-keepalive-dead-peer.md`) confirms the mobile Dart `grpc` client sets no
  keepalive and tolerates a 30s server cadence, so no mobile change is required. ✅

### Context Gates
- **Architecture** (WARN/none): No boundary violation. The note already establishes that this
  belongs in `main.ts` and explicitly must NOT go into `RealtimeConfig`/`ConfigService`
  (those are `WS_*` values). The plan honors that. No issue.
- **Rules** (none): No violation — `!` is explicitly avoided; no sensitive logging.
- **Roadmap** (WARN): This is a `fix`-class change (reaps zombie sessions). Recommend linking
  it to the corresponding ROADMAP milestone / note 51 in the commit body for traceability.
  Non-blocking.

## Observations (non-blocking)

1. **`GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS` can't be disabled via env.**
   With `Number(process.env.GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS) || 1`, an operator who sets
   the value to `0` (the only meaningful alternative — forbid pinging when no calls are active)
   gets `0 || 1 === 1`, silently re-enabling it. For the two time values `0` is never a sensible
   input so `|| default` is fine, but for this boolean-style flag the `||` fallback swallows a
   legitimate `0`. Since the streams here are long-lived (calls usually active), the practical
   impact is negligible and `1` is the intended default anyway — but if you want the env to be
   truly tunable, use a parse that only falls back on `NaN`, e.g.
   `Number.isFinite(n) ? n : 1`. Optional.

2. **`channelOptions` string key vs. typed field.** The plan uses
   `channelOptions: { 'grpc.http2.min_ping_interval_without_data_ms': 25_000 }`, which is valid
   (`ChannelOptions` accepts native grpc keys). Note the typed `keepalive` block also exposes
   `http2MinPingIntervalWithoutDataMs`, so the same guard could live inside the `keepalive`
   block for full type-checking. Either works; current approach is correct. Purely stylistic.

3. **Task 1 uses `Number.parseInt` in prose but `Number(...)` in the example.** Minor wording
   inconsistency. `Number(...)` is the better choice here (rejects `"30abc"` → `NaN` → default),
   so prefer the example. Harmless either way.

## Critical Issues
None.

## Positive Notes
- Excellent traceability: the plan is a faithful, verifiable implementation of research note 51,
  including the detection-budget reasoning (~40s reap + 30s grace) and the mobile-client tolerance check.
- Task 4 correctly stays verification-only and names the exact prod TLS-LB risk (idle-connection
  caps shorter than the keepalive interval) to confirm before shipping.
- Defensive parsing, explicit RULES adherence, and clean scoping (no proto/DB/migration) are all called out up front.

PLAN_REVIEW_PASS
