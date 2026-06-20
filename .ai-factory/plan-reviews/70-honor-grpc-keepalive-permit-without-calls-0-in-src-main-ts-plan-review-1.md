# Plan Review: Honor `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=0` in `src/main.ts`

**Plan:** `70-honor-grpc-keepalive-permit-without-calls-0-in-src-main-ts.md`
**Risk Level:** 🟢 Low

## Summary

The plan is small, well-scoped, and accurate. It correctly identifies the root
cause (`Number(x) || default` coerces an explicit `0` away because `0` is falsy)
and proposes the standard fix (`Number.isFinite`-checked parse). I verified the
plan against the actual source.

## Verification Against Codebase

- **File path correct.** `src/main.ts` exists and is the right target.
- **Line numbers correct.** The three reads quoted in Task 2 match the live source
  exactly at lines 82–86:
  ```ts
  const keepaliveTimeMs = Number(process.env.GRPC_KEEPALIVE_TIME_MS) || 30_000;
  const keepaliveTimeoutMs =
    Number(process.env.GRPC_KEEPALIVE_TIMEOUT_MS) || 10_000;
  const keepalivePermitWithoutCalls =
    Number(process.env.GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS) || 1;
  ```
- **Defaults preserved.** The proposed `numEnv(..., 30_000)`, `numEnv(..., 10_000)`,
  `numEnv(..., 1)` keep the exact same defaults as today.
- **No other read sites.** A repo-wide search for `GRPC_KEEPALIVE` finds these env
  vars used only in `src/main.ts` (other hits are plans/notes/reviews, not code).
  So applying the helper to these three reads is complete — nothing else parses
  these vars.
- **No migration, no DB, no proto, no security surface.** This is a transport-only
  config parse change; none of those gates apply.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** No boundary/dependency concern.
  The helper is explicitly kept local to `main.ts` (not exported), which is the
  right call — it avoids introducing a shared-util dependency for a one-off parse.
  No violation.
- **Rules (`mind_api/CLAUDE.md`):** Compliant. The change touches only bootstrap
  transport config; no logging, migration, or module-boundary rules are engaged.
- **Roadmap:** This is a follow-up hardening of the keepalive work tracked in plan
  64 / ROADMAP. Linkage is consistent. — WARN (informational only): consider noting
  this as a follow-up to milestone 64 in ROADMAP if that milestone is still open.

## Observations (non-blocking)

1. **Empty-string semantics — minor, but worth a deliberate choice.** The plan's
   own Note flags this correctly: `Number('') === 0`, so with the proposed
   `Number.isFinite(n) ? n : def` helper, an env var set to an *empty string* would
   be honored as `0` rather than falling back to the default. For
   `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS` an empty string most likely means "unset"
   (e.g. `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=` in a `.env`), and treating it as `0`
   could silently disable the flag. Recommend adopting the guarded variant the plan
   already mentions for all three reads, so empty string falls back to the default:
   ```ts
   const numEnv = (v: string | undefined, def: number): number => {
     if (v == null || v === '') return def;
     const n = Number(v);
     return Number.isFinite(n) ? n : def;
   };
   ```
   This is the safer default and removes the only real ambiguity in the change.
   Pick one behavior explicitly during implementation rather than leaving it to the
   reader of the Note.

2. **`keepalivePermitWithoutCalls` is really a boolean flag.** gRPC treats it as
   0/1. The current default `1` and the NaN-checked parse are fine, but a value like
   `2` or `-1` would pass through unchanged. Out of scope for this fix and not worth
   adding validation for — noting only for completeness.

3. **Task 3 build check is appropriate.** Deferring the pre-existing unrelated
   `tsc` errors in `biometric-stream-engine.service.spec.ts` is the right scope
   boundary. Since testing is off and this is a `main.ts`-only change, `npm run build`
   is a reasonable verification step.

## Conclusion

The plan is correct, complete for its stated scope, and low risk. The only thing I
would want the implementer to decide consciously is the empty-string behavior
(Observation 1) — the plan already surfaces it, so this is a recommendation to
resolve it rather than a blocking gap.

PLAN_REVIEW_PASS
