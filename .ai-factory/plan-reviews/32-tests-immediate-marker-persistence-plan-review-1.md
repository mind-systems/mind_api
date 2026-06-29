# Plan Review: Tests — immediate marker persistence (review 1)

**Plan:** `.ai-factory/plans/32-tests-immediate-marker-persistence.md`
**Target file:** `src/realtime/services/stream-engine.service.spec.ts`
**Risk Level:** 🟢 Low

## Verification against the codebase

All factual assumptions in the plan check out against the actual code:

- **`StreamDataType.SESSION_EVENT = 'session_event'`** exists in `src/realtime/constants/stream-data-types.ts` (lines 1–4). The proposed import path `../constants/stream-data-types` is correct from `services/`. ✔
- **`InstructionSample`** (`interfaces/session-buffer.interface.ts`) is `{ timestamp: number; data: unknown }` extending `Record<string, unknown>`. The `makeMarkerSample` helper returning `{ timestamp, data: { dataType, event } }` type-checks cleanly — `data` is `unknown`, so the nested object is assignable. ✔
- **`StreamEngine` constructor** takes exactly 3 args (`sampleRepo`, `moduleSessionRepo`, `configService`) at `stream-engine.service.ts:39–44`. The existing `beforeEach` already wires these mocks. ✔
- **Current `push` (lines 83–113) only buffers** — no immediate save path exists. So the Task-2 target cases will genuinely be RED now and the discriminator (`sample.data?.dataType === SESSION_EVENT`) is not yet present. ✔
- **`doFlush` (lines 130–171)** builds the row as `{ moduleSessionId, samples, flushedAt }` via `sampleRepo.create` → `sampleRepo.save`. The Task-2 assertion shape (`objectContaining({ moduleSessionId, samples: [...], flushedAt: expect.any(Date) })`) matches what feature 25 will emit for the one-element immediate write. ✔
- **`makeSample` (line 33)** uses string `data` (`'x'`) with no `dataType`, so every committed batch/overflow/flush/lifecycle/concurrency case stays GREEN under the new branch — the "no anti-targets" claim in Task 3 and note 30 (line 38) is accurate; I scanned all `push`-then-assert cases and none assert a `SESSION_EVENT` sample is buffered. ✔
- **`makeConfig` default `STREAM_MAX_BUFFER_BYTES = 1000`** is comfortably above marker sample sizes, so the new cases won't trip the byte cap. ✔

The plan is internally consistent with spec note `30-test-immediate-marker-persistence.md` and feature note `25-persist-ispaused.md`, and aligns with ROADMAP.md (Phase 60, lines 112 and 125).

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** No boundary issue. The change is confined to one spec file inside the realtime module; it drives the real `StreamEngine` per the modular-monolith testing convention. **PASS**
- **Rules (`RULES.md`):** No non-null assertions, no sensitive logging, not a gRPC method — none of the project rules apply to this test-only change. **PASS**
- **Roadmap (`ROADMAP_TESTS.md` / `ROADMAP.md`):** Directly fulfills the "Tests: immediate marker persistence" item (ROADMAP.md:112) and respects the committed-RED TDD contract described at lines 110 and 119. Linkage is explicit. **PASS**
- **Skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** Not present — no project-specific review overrides to apply.

## Findings (non-blocking)

### WARN 1 — Task 2 two-marker case should also set `repo.save.mockResolvedValue({})`
The single-marker case explicitly sets `repo.save.mockResolvedValue({})`, but the two-marker case (Task 2) does not mention it. Feature 25 (per note 25, line 47 / ROADMAP:125) implements the immediate write as fire-and-forget: `void sampleRepo.save(...).catch(...)`. If `repo.save` returns the default `jest.fn()` value (`undefined`), then `undefined.catch(...)` throws a `TypeError` synchronously inside `push` once the feature lands — turning an intended GREEN into a crash unrelated to the assertion. It is harmless in today's RED state (push only buffers), but to keep the case correct *after* 25 lands, the two-marker case should set `repo.save.mockResolvedValue({})` exactly like the single-marker case. Recommend adding that line to Task 2's second case.

### WARN 2 — committed RED tests will fail `npm test` / CI until note 25 lands
By design (TDD committed-RED, ROADMAP.md:110), the two Task-2 target cases fail until feature 25 is implemented. This is the stated intent, but it means the suite is red in the interim. Confirm the team's CI / pre-commit gating tolerates a known-RED suite between this commit and note 25 (e.g. the test-epic branch is not blocking merges), so this doesn't unexpectedly block other work. No change to the plan required — just an operational heads-up.

## Positive Notes

- The plan correctly insists on **synchronous** assertion of `repo.save` (no `await`, no fake-timer advance), matching the fire-and-forget call semantics described in note 30 (lines 41–42). This is the subtle part and it's spelled out precisely.
- Asserting a **one-element** `samples` array to distinguish an immediate write from a batch flush is the right discriminator and is explicitly required.
- The plan correctly forbids touching `makeSample` and inspecting the private `buffers` map (outcome-only / L1 constraint), and correctly identifies that there are no anti-targets to invert.
- Task dependencies (1 → 2/3 → 4) and the RED/GREEN split verification in Task 4, including the L4 escalation valve for any pre-existing case turning red, are well specified.

PLAN_REVIEW_PASS
