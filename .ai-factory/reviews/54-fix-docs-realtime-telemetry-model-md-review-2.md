## Code Review (Round 2): Fix `docs/realtime/telemetry-model.md`

**Plan:** `.ai-factory/plans/54-fix-docs-realtime-telemetry-model-md.md`
**Patch applied:** `.ai-factory/patches/54-fix-docs-realtime-telemetry-model-md-patch-1.md`
**Files Changed:** `docs/realtime/instruction-model.md` (1 line changed)

### Change

Line 58: removed false parenthetical ` (а также при перезапуске сервера)` from the `session_abandoned` description.

**Before:** `session_abandoned` записывается, когда истекает grace period без переподключения клиента **(а также при перезапуске сервера)**. `session_interrupted` — при явном `activity:stop`.

**After:** `session_abandoned` записывается, когда истекает grace period без переподключения клиента. `session_interrupted` — при явном `activity:stop`.

### Verification

- `StartupRecoveryService.onApplicationBootstrap()` only calls `this.repo.save()` — no `StreamEngine.push()`. Confirmed: server restart does not write to the instruction stream. Fix is correct. ✅
- `ActivityEngine.abandonActivity()` (line 174) remains the sole path that writes `StreamSessionEvent.ABANDONED` to the stream via `StreamEngine.push()`. Doc now accurately reflects this. ✅
- No other content was changed — all six `session_event` values, timeline diagram, class names, and See Also links remain intact and correct per review-1 verification. ✅

### Issues

None.

REVIEW_PASS
