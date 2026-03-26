# Plan: Migrate StateStore

## Context
Add a gRPC-compatible `streamMap` field to `StateStore` alongside the existing `socketMap`. This prepares the shared state container for gRPC streaming controllers (roadmap 3.3) without breaking existing Socket.IO consumers. The actual consumer migration (SyncNotifierService, LiveGateway) is deferred to the plans that create the corresponding gRPC controllers — those plans will wire `streamMap` and can remove `socketMap` references atomically. Full `socketMap` removal happens in roadmap 3.6 when Socket.IO infrastructure is deleted.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Extend StateStore

- [x] **Task 1: Add `streamMap` field to `StateStore`**
  Files: `src/realtime/state-store.ts`
  Add a new field `readonly streamMap = new Map<string, ServerWritableStream<unknown, unknown>>()` alongside the existing `socketMap`. Add the import `import { ServerWritableStream } from '@grpc/grpc-js'`. Do not remove `socketMap` or its `AuthenticatedSocket` import — both remain in use by `LiveGateway` and `SyncNotifierService` until their gRPC controllers are created. Using `<unknown, unknown>` generics instead of `<any, any>` preserves type safety; each gRPC controller will narrow the type when it reads from the map.

- [x] **Task 2: Update `ObservabilityService` to report both maps** (depends on Task 1)
  Files: `src/realtime/services/observability.service.ts`
  Add `const connectedStreams = this.stateStore.streamMap.size` and include it in the log line: `Realtime metrics: activeSessions=${activeSessions} connectedSockets=${connectedSockets} connectedStreams=${connectedStreams}`. Keep the existing `connectedSockets` metric — it remains valid until Socket.IO is removed.
