# Patch: 40 — Remove presence from proto/module_state.proto

**Source review:** `.ai-factory/reviews/40-remove-presence-from-proto-module-state-proto-review-1.md`

## Issues to fix

### 1. Roadmap checkboxes not updated (bookkeeping)

**File:** `.ai-factory/ROADMAP.md`
**Problem:** Lines 166–168 show three items as unchecked (`[ ]`) even though the implementation is fully committed. This makes the roadmap inaccurate — anyone reading it would think these tasks are still pending.

**Fix:** Change lines 166–168 from `[ ]` to `[x]`:

```diff
-- [ ] **Remove `presenceMap` from `src/realtime/state-store.ts`** — delete import of `PresenceState` and the `readonly presenceMap` field
-- [ ] **Remove `PresenceService` from `src/realtime/realtime.module.ts`** — delete import, remove from `providers` array and `exports` array
-- [ ] **Remove presence handling from `src/realtime/module-state.grpc.controller.ts`** — delete: import of `PresenceCmd` and `PresenceState` from generated proto; import of `PresenceService`; `presenceService` constructor parameter; `presenceService.online()` call on stream open (line 100); `presenceService.get()` and `presenceService.offline()` calls on stream close (lines 137–142); the `else if (msg.presence !== undefined)` routing branch (lines 179–180); the entire `handlePresence()` private method (lines 335–353)
+- [x] **Remove `presenceMap` from `src/realtime/state-store.ts`** — delete import of `PresenceState` and the `readonly presenceMap` field
+- [x] **Remove `PresenceService` from `src/realtime/realtime.module.ts`** — delete import, remove from `providers` array and `exports` array
+- [x] **Remove presence handling from `src/realtime/module-state.grpc.controller.ts`** — delete: import of `PresenceCmd` and `PresenceState` from generated proto; import of `PresenceService`; `presenceService` constructor parameter; `presenceService.online()` call on stream open (line 100); `presenceService.get()` and `presenceService.offline()` calls on stream close (lines 137–142); the `else if (msg.presence !== undefined)` routing branch (lines 179–180); the entire `handlePresence()` private method (lines 335–353)
```

---

No code fixes required — the review found zero critical issues or bugs. The only action item is this roadmap bookkeeping update.
