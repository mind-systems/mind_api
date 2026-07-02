# Plan: Persist discrete markers immediately; batch only continuous streams

## Context
Make discrete `SESSION_EVENT` markers durable the instant they are pushed by branching inside `StreamEngine.push` to persist them immediately (fire-and-forget), while continuous `breath_phase` instruction samples keep buffering + periodic flush exactly as today. This prevents a crash before the periodic timer from silently losing load-bearing timeline markers.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Route markers to an immediate write

- [x] **Task 1: Branch `push` on sample kind, persist markers immediately**
  Files: `src/realtime/services/stream-engine.service.ts`
  Import `StreamDataType` from `../constants/stream-data-types`. At the very top of `push(sessionId, sample)` — before any buffer lookup, `maxSessions` check, or byte-cap logic — detect a discrete marker with `(sample.data as { dataType?: string } | undefined)?.dataType === StreamDataType.SESSION_EVENT`. `sample.data` is typed `unknown`, so cast narrowly to read `dataType`.
  When it is a marker:
  - Persist it immediately as a one-element row, fire-and-forget so `push` stays synchronous and off the client path:
    `void this.sampleRepo.save(this.sampleRepo.create({ moduleSessionId: sessionId, samples: [sample], flushedAt: new Date() })).catch((err: unknown) => this.logger.error(\`Failed to persist marker for sessionId=${sessionId}\`, err));`
  - Do **not** buffer the marker and do **not** apply the byte-cap or `maxSessions` check to it (markers are tiny and rare).
  - Return a success `PushResult`: `{ accepted: true, droppedCount: 0, totalReceived: <buffer.totalReceived if a buffer exists, else 0> }`. Callers ignore the return value for markers, so do not create a buffer just to produce this number — read it from an existing buffer if present, otherwise return `0`.
  Everything else (continuous `breath_phase`, whose `data` carries no `dataType`, and any sample without a `SESSION_EVENT` discriminator) falls through to the existing buffer + byte-cap + `flushAll` logic **unchanged**.

  Do **not** rename `push`, change its signature/return type, or add a public method — committed `push(...)` assertions must stay valid. No changes to the 7 marker emitters in `activity-engine.service.ts`, the instruction controller, entities, DTOs, proto, or the client. `breath_phase` batching, the byte-cap, and overflow `droppedCount` accounting stay untouched — only `SESSION_EVENT` samples divert.
