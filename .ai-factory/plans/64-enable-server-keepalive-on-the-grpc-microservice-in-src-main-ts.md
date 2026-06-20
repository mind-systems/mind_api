# Plan: Enable server keepalive on the gRPC microservice in `src/main.ts`

## Context
Add HTTP/2 keepalive PINGs to the gRPC server so half-open/dead peers (abrupt mobile drops) are reaped in ~40s, letting the existing disconnect → grace → abandon machinery fire instead of holding zombie streams open forever.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Bootstrap keepalive

- [x] **Task 1: Read env-driven keepalive values before microservice bootstrap**
  Files: `src/main.ts`
  In `bootstrap()`, just above the existing `const grpcUrl = process.env.GRPC_URL ...` read (line 81), add three numeric reads straight from `process.env` with `Number.parseInt` + safe defaults — `main.ts` runs before `ConfigModule`, mirroring the existing `LOG_*` / `GRPC_URL` reads (do NOT route through `ConfigService` or `RealtimeConfig`; this is a transport-bootstrap concern, not a `WS_*` value):
  - `GRPC_KEEPALIVE_TIME_MS` → default `30_000`
  - `GRPC_KEEPALIVE_TIMEOUT_MS` → default `10_000`
  - `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS` → default `1`
  Parse defensively so a missing/non-numeric env falls back to the default (e.g. `const keepaliveTimeMs = Number(process.env.GRPC_KEEPALIVE_TIME_MS) || 30_000;`). Do NOT use the non-null assertion operator (`!`) per project RULES.

- [x] **Task 2: Add the typed `keepalive` + `channelOptions` block to the gRPC microservice options** (depends on Task 1)
  Files: `src/main.ts`
  Inside the existing `app.connectMicroservice<MicroserviceOptions>({ transport: Transport.GRPC, options: { ... } })` block (lines 82–103), add to the `options` object — alongside `url`, `package`, `protoPath` — the typed keepalive block (verified present on `GrpcOptions.options.keepalive` in `@nestjs/microservices/interfaces/microservice-configuration.interface.d.ts:40`):
  ```ts
  keepalive: {
    keepaliveTimeMs,
    keepaliveTimeoutMs,
    keepalivePermitWithoutCalls,
  },
  channelOptions: {
    'grpc.http2.min_ping_interval_without_data_ms': 25_000,
  },
  ```
  Use the locals from Task 1. The `channelOptions` min-ping guard keeps the server's ping cadence above a strict client's tolerated minimum so it never replies `GOAWAY ENHANCE_YOUR_CALM`. This single block covers all tunnels (control/instruction/biometric/sync) — keepalive is channel-level. Do NOT touch any stream controller. No proto / DB / migration change.

- [x] **Task 3: Document the new env keys in the env files** (depends on Task 2)
  Files: `.env`, `.env.dev`, `.env.prod`
  Under the existing `# gRPC` section (next to `GRPC_URL`), add the three new keys with their default values and a short comment, keeping them commented-or-set consistently with how `GRPC_URL` is declared:
  ```
  # gRPC keepalive (server PINGs idle/dead peers so half-open streams get reaped)
  GRPC_KEEPALIVE_TIME_MS=30000
  GRPC_KEEPALIVE_TIMEOUT_MS=10000
  GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=1
  ```
  These are operator-tunable transport knobs; the code already falls back to the same defaults if a key is absent.

- [x] **Task 4: Reconcile final numbers with the mobile Dart `grpc` client policy** (depends on Task 2)
  Files: (verification only — no code change expected)
  Per the spec guard and note `51-grpc-server-keepalive-dead-peer.md`: the mobile client (`mind_mobile/lib/Core/Grpc/GrpcClient.dart`) sets no keepalive and runs `grpc` 5.1.0 defaults, which tolerate a 30s server ping cadence — so no mobile change is required. Confirm the shipped values (`keepaliveTimeMs=30000`, `min_ping_interval_without_data_ms=25000`) stay within that tolerance and that nothing in the prod TLS-LB path caps idle connections shorter than the keepalive interval. If a mismatch is found, adjust the defaults in Task 1 before shipping rather than changing the mobile client.

## Commit Plan
- **Commit 1** (after tasks 1–4): "Enable gRPC server keepalive to reap dead peers"
