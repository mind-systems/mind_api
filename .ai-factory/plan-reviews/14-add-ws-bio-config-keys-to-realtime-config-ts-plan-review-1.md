# Plan Review: Add `WS_BIO_*` config keys to `realtime-config.ts`

**Plan:** `14-add-ws-bio-config-keys-to-realtime-config-ts.md`
**Risk Level:** 🟢 Low
**Tasks Reviewed:** 1

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** Not consulted in depth — the change is a leaf-level addition to a constants map inside the realtime module and does not affect module boundaries, dependencies, or the modular-monolith pattern. No alignment issues.
- **Rules (`.ai-factory/RULES.md`):** Reviewed. None of the three rules (no `!`, no sensitive logs, lean logs, `@Payload()` on gRPC methods) apply to a constants-only change. No violations.
- **Roadmap (`.ai-factory/ROADMAP.md`):** Not opened for this scope. The plan is a small enabling step for the upcoming biometric stream engine. The plan explicitly notes "no other code depends on these keys yet" — acceptable to keep the change minimal; the engine work that uses these keys should reference the roadmap milestone when implemented.

## Verification Against Target File

Read `src/realtime/constants/realtime-config.ts`:

```ts
export const RealtimeConfig = {
  RATE_LIMIT_ACTIVITY_START_PER_MIN: 'WS_RATE_LIMIT_ACTIVITY_START_PER_MIN',
  RATE_LIMIT_WINDOW_MS: 'WS_RATE_LIMIT_WINDOW_MS',
  STREAM_MAX_BUFFER_BYTES: 'WS_STREAM_MAX_BUFFER_BYTES',
  STREAM_MAX_SESSIONS: 'WS_STREAM_MAX_SESSIONS',
  BACKPRESSURE_SAMPLES_PER_SEC: 'WS_BACKPRESSURE_SAMPLES_PER_SEC',
  STREAM_FLUSH_INTERVAL_MS: 'WS_STREAM_FLUSH_INTERVAL_MS',
} as const;
```

- The file path in the plan is correct.
- The naming convention claimed by the plan ("constant key in SCREAMING_SNAKE_CASE, value is the env-var name string prefixed with WS_") matches every existing entry.
- The proposed `BIO_*` keys map 1:1 to the existing non-`BIO` keys (max buffer bytes, max sessions, backpressure samples/sec, flush interval ms), which is a sensible parallel structure for a second stream type.
- Appending after `STREAM_FLUSH_INTERVAL_MS` while preserving `as const` is correct.

## Critical Issues

None.

## Minor Notes (Non-Blocking)

1. **Default values are documented in the plan but not declared** — the plan correctly defers defaults to consumer code (`ConfigService.get(..., <default>)`). This is consistent with the existing file (no defaults stored here). Good call.
2. **No accompanying `.env*` updates** — the plan does not touch `.env`, `.env.dev`, or `.env.prod`. Since the keys are optional (defaults applied at the consumer site) this is acceptable; if operations want to override them in deployed environments, that should happen in the engine-implementation plan, not here.
3. **Docs:** `docs/realtime/configuration.md` is listed in `CLAUDE.md` as the canonical place where `WS_*` and `WS_BIO_*` env vars are documented. The plan sets `Docs: no`, which is consistent with the stated scope (file must compile standalone, engine consumes them later). The follow-up plan that wires these into the engine MUST update `docs/realtime/configuration.md` — flag for the next plan, not this one.
4. **Build verification:** Task already requires `npm run build` to succeed. This is sufficient for a constants-only change; no tests are needed.

## Architectural & Security Review

- No new imports, no new module dependencies, no DB migrations, no API surface change.
- No security implications — only string constants for env-var keys, no values, no logging.
- No N+1 / performance / async concerns — this is a top-level object literal.

## Positive Notes

- Scope is tightly bounded — one file, one task, no speculative changes.
- Plan correctly identifies that defaults belong at the consumption site, not the key registry.
- Naming follows the existing pattern exactly, including the `STREAM_` prefix where it matches the WS_BIO_STREAM_* env var.
- Explicit acknowledgement that "no other code depends on these keys yet" rules out the risk of breaking downstream consumers.

PLAN_REVIEW_PASS
