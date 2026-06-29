# Code Review: Tests — immediate marker persistence (review 1)

**Plan:** `.ai-factory/plans/32-tests-immediate-marker-persistence.md`
**Changed code:** `src/realtime/services/stream-engine.service.spec.ts` (test-only)
**Scope:** TDD committed-RED tests. No production code changed.

## What was reviewed

`git diff HEAD` + `git status`. The only code change is `stream-engine.service.spec.ts`; the other staged files are plan/plan-review/sidecar artifacts (non-code). I read the full spec file, the production `stream-engine.service.ts`, `session-buffer.interface.ts`, and `stream-data-types.ts`, then ran the suite and the linter.

## Verification performed

- **RED/GREEN split confirmed by running the suite** — `npx jest src/realtime/services/stream-engine.service.spec.ts`: **2 failed, 20 passed**. The two failing cases are exactly the Task-2 target cases ("single marker writes immediately", "two distinct markers …"), each failing with `Number of calls: 0` because today's `push` only buffers — the intended committed-RED state for feature note 25.
- **Contrast cases pass now** — the `breath_phase` and `makeSample` cases are among the 20 passing; both push, assert `repo.save` not called synchronously, then flush and assert one save.
- **No pre-existing case regressed** — all original `push`/`flush`/`flushAll`/`periodic flush`/`lifecycle`/`concurrency`/`maxSamplesPerSecond` cases still pass (escalation valve L4 clean).
- **Lint clean** — `npx eslint stream-engine.service.spec.ts` exits 0. TS compiles (ts-jest ran).

## Correctness analysis

- **Will the contrast cases stay GREEN after feature 25 lands?** Feature 25's discriminator is `sample.data?.dataType === SESSION_EVENT`. `breath_phase` carries `{ phase: 'exhale' }` (`.dataType` undefined → buffered) and `makeSample` carries the string `'x'` (`.dataType` undefined → buffered). Both correctly stay on the batch path → remain GREEN. ✔
- **Will the target cases turn GREEN after feature 25 lands?** The single-marker assertion shape `objectContaining({ moduleSessionId: 's1', samples: [<marker>], flushedAt: expect.any(Date) })` matches the row feature 25 will build (`{ moduleSessionId, samples: [sample], flushedAt: now }`, per `doFlush` precedent at `stream-engine.service.ts:143-149`). Deep equality against a fresh `makeMarkerSample('paused')` matches the pushed object. `expect.any(Date)` matches the fake-timer `ClockDate` (confirmed in the failure output). ✔
- **Fire-and-forget safety post-25** — the plan-review's WARN 1 was addressed: the two-marker case sets `repo.save.mockResolvedValue({})` (line 270), so once feature 25 implements `void sampleRepo.save(...).catch(...)`, `save()` returns a real promise and `.catch` won't throw a `TypeError`. Both target cases set the resolved-value mock. ✔
- **Outcome-only / L1** — assertions read only mock-visible `repo.create`/`repo.save` calls; the private `buffers` map is never inspected. ✔
- **One-element discriminator** — both target cases assert `samples: [<single marker>]`, distinguishing the immediate write from a batch flush, as required. ✔

## Findings

None blocking. One operational note carried forward from the plan review for visibility:

- **INFO — suite is intentionally RED until note 25 lands.** By the committed-RED TDD contract (ROADMAP.md:110), `npm test` / CI will show these 2 failures until feature note 25 is implemented. This is by design, not a defect in the change; just confirm the team's gating tolerates a known-RED test-epic branch so it doesn't block unrelated merges.

REVIEW_PASS
