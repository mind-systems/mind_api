# Plan: Delete `src/realtime/services/presence.service.ts`

## Context
Remove the presence service file as part of the broader presence feature cleanup (roadmap section 8.2).

## Status: Already Complete

The file `src/realtime/services/presence.service.ts` does not exist on disk. No references to `PresenceService` or `presence.service` remain in any source file under `src/`. The `realtime.module.ts` and `state-store.ts` are already clean — no imports, no provider registration, no exports.

No tasks are needed. The milestone can be marked as done.
