# Analytics read tolerant of bio on root-or-child (windowed)

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The analytics read path currently joins bio strictly by `moduleSessionId = sessionId` (the activity). This must become tolerant: read bio from the activity's own id **or** from its `rootSessionId` sliced by the activity's time window.
- Deploying the tolerant read **before** flipping bio ingest to the root ([[10-bio-ingest-to-root]]) is the trick that keeps every step non-breaking: old sessions (bio on child, `rootSessionId` null) behave exactly as today; new root-bound bio is found via the root branch once ingest flips. No dashboard gap.

## Details

### Current state — `src/sessions/sessions.service.ts`
- `assertSessionOwnership` loads the full `ModuleSession` (so `rootSessionId`, `startedAt`, `endedAt` are available).
- `listBiometrics` (raw path) and `aggregateBiometrics` (SQL unnest path) both filter `bio_session_samples` by `moduleSessionId = sessionId`, then trim by per-sample `timestamp` against optional `from`/`to`.
- `listInstructions` filters `session_stream_samples` by `moduleSessionId = sessionId` — **unchanged** (instructions stay per-child).

### Change — bio reads only
- Resolve the bio source id set: `[sessionId]` plus `session.rootSessionId` when non-null.
- Raw path (`listBiometrics`): `where.moduleSessionId = In(ids)`. Apply the time window: when `from`/`to` are absent, default them to `[session.startedAt, session.endedAt]` so a child slices only its interval out of the continuous root timeline. Keep `ROW_CAP` / `FLAT_CAP` / `flushedAt` coarse filter.
- SQL path (`aggregateBiometrics`): change `b."moduleSessionId" = $session` to `b."moduleSessionId" = ANY($ids)`; default the per-sample `timestamp` window to the session interval when `from`/`to` absent (same lockstep `bucketIndexForMs` epoch-0 origin).

### Guards / gotchas
- Defaulting the window to `[startedAt, endedAt]` is what makes overlapping activities each return their own slice of one shared root bio stream — without it a child would return the entire root timeline.
- For old data (`rootSessionId` null) the id set is just `[sessionId]` and the window default is the session's own interval → identical to today.
- No double counting: bio lives on exactly one row-owner (child today, root after migration), never both.
- Keep the existing 413 (`PayloadTooLargeException`) guards.

### Verify
- Old session bio still returned identically.
- A session whose bio sits on its root returns only the windowed slice.
- Two overlapping children of one root each return their own window of the same bio rows.

## Open Questions
- None — depends only on the schema column from [[02-root-session-schema]].
