# gRPC server keepalive — detect half-open peers so the session lifecycle fires

**Date:** 2026-06-20
**Source:** conversation context

## Key Findings

- A meditation session (`98d946a6-…`) stayed `active` for 3 days after a mobile network drop. `StreamEngine`/`BiometricStreamEngine` logged `flush: nothing to flush` every 5s the whole time, and `Realtime metrics: activeSessions=1` never dropped.
- Root cause: the entire disconnect → grace → abandon machinery is gated on the RxJS teardown (`subscriber.add(...)`) of the control stream `ModuleStateGrpcController.trackActivity` (`src/realtime/module-state.grpc.controller.ts:161-178`). That teardown only fires when gRPC observes the transport closing. On an abrupt mobile drop the TCP connection goes **half-open** and, with no keepalive, the server holds the streaming RPC open indefinitely → teardown never runs → `handleTransportDisconnect` is never called → no `DISCONNECTED`, no grace timer, no `abandonActivity`.
- The gRPC microservice bootstrap in `src/main.ts:82-103` passes **no keepalive options** — no `grpc.keepalive_time_ms`, no `keepalive_timeout_ms`, nothing. The server never PINGs idle/dead peers.
- Corroborating signal: `connectedStreams` climbed `4 → 6` in the logs — `ActiveStreamRegistry.size` (`src/realtime/services/active-stream-registry.service.ts:8-14`). The phone reopened fresh control streams on reconnect while the stale half-open subscribers were never deregistered → zombie subscribers accumulated.
- This is the **first-cause** fix: turning on server keepalive makes the existing, otherwise-correct grace/abandon logic actually trigger on the most common real-world failure (mobile loses signal / OS suspends the app without a clean close). The idle-session watchdog (note 52) is the independent defense-in-depth layer.

## Details

### The change

NestJS exposes a typed keepalive block on the gRPC transport options (verified in `node_modules/@nestjs/microservices/interfaces/microservice-configuration.interface.d.ts:40-49`):

```ts
keepalive?: {
  keepaliveTimeMs?: number;
  keepaliveTimeoutMs?: number;
  keepalivePermitWithoutCalls?: number;
  // ...
};
channelOptions?: ChannelOptions;
```

Add a `keepalive` block (and, if needed, `channelOptions` for the HTTP/2 min-ping guard) to the `options` object in `app.connectMicroservice<MicroserviceOptions>({ transport: Transport.GRPC, options: { … } })` in `src/main.ts`.

Suggested values (env-driven, with these defaults):

- `keepaliveTimeMs: 30_000` — server sends an HTTP/2 PING every 30s on an otherwise-idle connection.
- `keepaliveTimeoutMs: 10_000` — if the PING is not acked within 10s, the connection is considered dead and the streaming RPCs on it are closed (→ teardown fires → grace → abandon).
- `keepalivePermitWithoutCalls: 1` — permit pinging even without active calls (defensive; our streams are long-lived so calls are usually active anyway).
- `channelOptions: { 'grpc.http2.min_ping_interval_without_data_ms': 25_000 }` — keep the server's own ping cadence above the client's tolerated minimum so a strict client doesn't reply with `GOAWAY ENHANCE_YOUR_CALM`.

Detection budget with these values: a dead peer is reaped in ≈ `keepaliveTimeMs + keepaliveTimeoutMs` (~40s), after which the existing 30s grace window (`WS_RECONNECT_GRACE_MS`) runs and the session is abandoned. Total worst case ≈ 70s instead of forever.

### Config wiring

Follow the existing env convention. `src/main.ts` runs before `ConfigModule`, so read straight from `process.env` with numeric parse + defaults (the file already does this for `LOG_*`, `GRPC_URL`, ports). Suggested env keys: `GRPC_KEEPALIVE_TIME_MS`, `GRPC_KEEPALIVE_TIMEOUT_MS`, `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS`. Do **not** add these to `RealtimeConfig` (`src/realtime/constants/realtime-config.ts`) — that constant set is `WS_*` and consumed via `ConfigService` inside the realtime module; this is a transport-bootstrap concern that lives in `main.ts`.

### Scope / guards

- One config block on the single gRPC server covers **all** tunnels (control, instruction, biometric, sync) — keepalive is a channel-level property, not per-RPC. Do not touch the individual stream controllers.
- Coordinate values with the mobile gRPC client (Dart `grpc` package) keepalive policy. The client enforces a minimum acceptable server ping interval; if the server pings faster than the client permits, the client sends `GOAWAY`. Keeping `keepaliveTimeMs` at 30s with the `min_ping_interval_without_data_ms` guard at 25s is comfortably within typical client tolerances, but verify against `mind_mobile` once it lands.
- This is transport-only. No proto change, no DB change, no migration.

### How to verify

- Start the server, open a streaming RPC from a client, then kill the client's network ungracefully (drop the socket / airplane mode — not a clean stream `complete`). Within ~`keepaliveTime + keepaliveTimeout` the server should log `Disconnected: userId=…` from the `trackActivity` teardown, then `Session disconnected`, then after the grace window `Session abandoned`.
- Confirm `Realtime metrics: activeSessions` returns to 0 and the `flush: nothing to flush` spam for that `sessionId` stops (buffer deleted by the `@OnEvent(SessionEvents.ABANDONED)` handlers in both engines).

## Mobile client — verified (mind_mobile research, 2026-06-20)

- The Dart `grpc` client (`mind_mobile/lib/Core/Grpc/GrpcClient.dart:24-25`) sets **no keepalive at all** — `ChannelOptions` carries only `credentials`. It runs on `grpc` package defaults. This confirms the server cannot rely on client-originated pings; the server must ping (this fix).
- The client **tolerates** server keepalive pings: Dart `grpc` 5.1.0 accepts server-originated pings and does not enforce a strict min-receive-ping-interval that would emit `GOAWAY ENHANCE_YOUR_CALM` at a 30s server cadence. So the server change ships **without any mobile change required**.
- Client reconnect is robust: all three realtime streams (`ModuleStateChannel`, `ModuleInstructionStream`, `BiometricStreamClient`) handle `onError`/`onDone` by calling `disconnect()` + `scheduleReconnect()` with exponential backoff (1–30s, ±25% jitter), reset on first response. When the server's keepalive closes a half-open stream, the (offline) phone simply reconnects once its network returns.
- Prod connects over TLS to `grpc.mind-awake.life:443` (`Environment.dart`), likely behind a load balancer. The 25s `min_ping_interval_without_data_ms` guard keeps the server cadence comfortably under typical LB/proxy ping tolerances; verify the LB does not itself cap idle connections shorter than the keepalive interval.

## Open Questions

- None blocking. Optional symmetric hardening: add **client-side** keepalive in `mind_mobile` (`ChannelOptions(keepAlive: ClientKeepAlive(...))`) so the phone detects a dead server / NAT rebind faster and keeps the prod TLS-LB connection warm. Defense-in-depth, not required for this fix — tracked separately on the mobile roadmap.
