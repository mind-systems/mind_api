# Code Review: Add `WS_BIO_*` config keys to `realtime-config.ts`

**Plan:** `14-add-ws-bio-config-keys-to-realtime-config-ts.md`
**Scope:** Single file, four new constant entries.

## Files Reviewed

- `src/realtime/constants/realtime-config.ts` (read in full, 13 lines)

## Verification

- All four `BIO_*` entries appended in the order specified by the plan, after `STREAM_FLUSH_INTERVAL_MS`.
- Each key follows the existing convention: `SCREAMING_SNAKE_CASE` identifier, value is the env-var name string prefixed with `WS_`.
- The four env-var values exactly match note 03 §7: `WS_BIO_STREAM_MAX_BUFFER_BYTES`, `WS_BIO_STREAM_MAX_SESSIONS`, `WS_BIO_BACKPRESSURE_SAMPLES_PER_SEC`, `WS_BIO_STREAM_FLUSH_INTERVAL_MS`.
- `as const` assertion preserved — literal types still narrow correctly.
- No defaults declared in this file, consistent with existing entries (defaults will be applied at the consumption site via `ConfigService.get(..., <default>)`).
- No duplicate keys.
- `npm run build` (`nest build`) succeeds with no errors or warnings.

## Rules Compliance

- No non-null assertions introduced.
- No logging, no sensitive data.
- No gRPC method changes; `@Payload()`/`@GrpcCurrentUser()` rule does not apply.

## Runtime / Correctness Considerations

- **No runtime change yet.** The constants are not referenced anywhere — confirmed via grep: there are no consumers of `RealtimeConfig.BIO_*` keys in the codebase. The file compiles standalone as required by the milestone.
- **No type collisions.** TypeScript infers literal union from `as const`; no overlap between old and new keys.
- **No env-var collisions.** All four new env vars are prefixed `WS_BIO_*`, distinct from the existing `WS_*` non-BIO variants. No risk of an operator's existing `WS_STREAM_*` setting silently affecting the biometric stream.

## Findings

None.

REVIEW_PASS
