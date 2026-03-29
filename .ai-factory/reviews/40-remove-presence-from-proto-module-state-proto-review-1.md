# Code Review: Remove presence from proto/module_state.proto

**Files Reviewed:** 8 (plan, proto, controller, state-store, module, deleted service, deleted spec, deleted interface)
**Risk Level:** Low

## Proto contract (`proto/module_state.proto`)

- `enum PresenceState`, `message PresenceCmd`, and `PresenceCmd presence = 6` in the `SessionRequest` oneof are all removed cleanly.
- Field number `6` is left unused in the oneof. This is correct for proto3 — unused field numbers are safe and don't need `reserved` inside a `oneof`.
- Regenerated stubs in `proto/generated/module_state.ts` contain no `PresenceCmd`, `PresenceState`, or `presence` references. Confirmed via grep.

## Controller (`src/realtime/module-state.grpc.controller.ts`)

- `PresenceCmd`, `PresenceState` removed from proto import.
- `PresenceService` import and constructor injection removed.
- `handlePresence()` method deleted.
- `else if (msg.presence !== undefined)` routing branch removed.
- `presenceService.online()`, `.get()`, `.offline()` calls replaced with local `connectedAt` variable.

**`connectedAt` scoping is correct.** Declared as `let connectedAt = 0` in the Observable factory (line 81), assigned `Date.now()` inside `setup()` (line 98), read in teardown (line 135). The `connectedAt ? ...` check handles the edge case where teardown fires before `setup()` sets the timestamp (e.g. setup throws on `handleReconnect`) — logs `connectedDurationMs=0`, same behavior as before when `presenceService.get()` returned `undefined`.

**No closure capture issue.** The teardown callback (registered via `subscriber.add()`) captures `connectedAt` by reference through the enclosing scope, so it correctly reads the value set later by `setup()`.

## Deleted files

- `src/realtime/services/presence.service.ts` — deleted. No remaining importers.
- `src/realtime/services/presence.service.spec.ts` — deleted. Tests for deleted code.
- `src/realtime/interfaces/presence-state.interface.ts` — deleted. No remaining importers.

## StateStore (`src/realtime/state-store.ts`)

- `PresenceState` import and `presenceMap` field removed. Class is now empty.
- `StateStore` is still registered as a provider and exported from `RealtimeModule`, but nothing injects it. This is technically dead code, but the plan explicitly notes it may gain new fields in the future. Not blocking.

## Module (`src/realtime/realtime.module.ts`)

- `PresenceService` removed from imports, providers, and exports. Clean.

## Cross-cutting checks

- **No remaining `presence` references in `src/`** — verified via codebase-wide grep. The only "presence" mentions are in `breath_sessions.proto` comments about proto3 field presence tracking (unrelated concept).
- **No docs reference `PresenceCmd` or `PresenceService`** — verified `docs/` directory.
- **No `AppModule` references** — confirmed clean.
- **TypeScript compiles cleanly** — `npx tsc --noEmit` passes with no errors.

REVIEW_PASS
