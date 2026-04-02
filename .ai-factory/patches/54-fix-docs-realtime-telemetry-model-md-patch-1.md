# Patch: 54-fix-docs-realtime-telemetry-model-md

**Review:** `.ai-factory/reviews/54-fix-docs-realtime-telemetry-model-md-review-1.md`
**Issues to fix:** 1

---

## Issue 1: Remove false "server restart" claim from `session_abandoned` description

**File:** `docs/realtime/instruction-model.md`
**Line:** 58

**Problem:** The parenthetical "(а также при перезапуске сервера)" claims a `session_abandoned` instruction sample is written to the stream on server restart. This is false. `StartupRecoveryService.onApplicationBootstrap()` only updates the database (`repo.save()` sets `status = ABANDONED` and `endedAt`). It does not call `StreamEngine.push()`, so no instruction sample is emitted. Only `ActivityEngine.abandonActivity()` writes to the stream, and it is only triggered by the grace period timer.

**Current text (line 58):**
```
`session_abandoned` записывается, когда истекает grace period без переподключения клиента (а также при перезапуске сервера). `session_interrupted` — при явном `activity:stop`.
```

**Fixed text:**
```
`session_abandoned` записывается, когда истекает grace period без переподключения клиента. `session_interrupted` — при явном `activity:stop`.
```

**Action:** Remove ` (а также при перезапуске сервера)` from the sentence. No other changes needed.
