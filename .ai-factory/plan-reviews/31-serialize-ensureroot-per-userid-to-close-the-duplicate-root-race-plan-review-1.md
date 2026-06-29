# Plan Review: Serialize `ensureRoot` per userId to close the duplicate-root race

**Plan:** `31-serialize-ensureroot-per-userid-to-close-the-duplicate-root-race.md`
**Target:** `mind_api/src/realtime/services/activity-engine.service.ts` (+ spec)
**Risk Level:** 🟢 Low

## Verdict

The plan is sound. The diagnosis is real, the chosen mechanism (per-`userId` in-flight
promise map) correctly closes the TOCTOU for the single-process case, file paths and API
usage are accurate, and the test design produces a genuine RED→GREEN signal. The findings
below are clarifications and minor risks, none blocking.

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** PASS. The change is fully contained inside
  `ActivityEngine` and the existing `ActivitySessionStore` API. No module boundary is
  crossed, no new provider, no cross-module import. Consistent with the modular-monolith
  rule that entities/repos stay within their owning module.
- **Rules (`RULES.md`):** PASS. The plan explicitly removes the non-null assertion at
  `activity-engine.service.ts:79` (`getRootId(userId)!`) and replaces it with an explicit
  guard — directly honoring the "NEVER use `!`" rule. Logging stays lean (preserves the
  single existing `Root session created` log, adds none).
- **Roadmap (`ROADMAP.md`):** PASS. Matches the open task at line 106 ("Serialize
  `ensureRoot` per userId to close the duplicate-root race") under the "Cleanup + race fix"
  section, and aligns with spec note `43-serialize-ensureroot-race.md` (confirmed present).
  No-migration / no-DB-unique-index / in-process-lock-only scope matches the roadmap entry
  verbatim.

## Correctness Verification

Verified against the actual source:

- The TOCTOU is real. `ensureRoot` (`:77-90` check, `:92-117` create) reads `getRoot`,
  then `await repo.save`, then `setRoot`. Two concurrent connect streams for one user
  (controller `:186` connect-time call, and `:409` ROOT-start) can both pass the empty-store
  check before either reaches `setRoot`, minting two roots. The second `setRoot` orphans the
  first row.
- The fix mechanism is correct for Node's single-threaded model. Because there is no `await`
  between the join-path read (`ensureRootInFlight.get`) and `set`, and `setRoot` runs only
  after `repo.save` resolves, a concurrent caller deterministically observes the in-flight
  promise and joins it. The target test's `Promise.all([ensureRoot('u'), ensureRoot('u')])`
  exercises exactly this interleaving.
- `try { return await p } finally { delete }` correctly clears the map on both resolve and
  reject, so a failed create does not poison subsequent retries, and the map does not leak
  entries. Good.
- `setRoot` writes `rootSessionId` and `root` atomically (`activity-session-store.service.ts:71-72`),
  so `getRoot` truthy ⟺ `getRootId` truthy in production — the synthesized fast path stays
  consistent.

## Findings (non-blocking)

### 1. `reconstructRoot` cannot "fall through to creating a root" — clarify ownership of the guard
Task 1 instructs: read `const rootId = getRootId(userId)`; "if it is falsy, fall through to
creating a root (do not synthesize from a missing id)." But `reconstructRoot` is described as
a **synchronous** helper returning `ModuleSession` — it has no way to trigger the async
`repo.create`/`save` path. The falsy-`rootId` branch must be handled in `ensureRoot`, not
inside `reconstructRoot`. Two clean options for the implementer:
- Have `reconstructRoot` return `ModuleSession | null` and let `ensureRoot`'s fast path do
  `const r = reconstructRoot(...); if (r) return r;` before falling into the create path; or
- Keep the `getRootId` falsy check in `ensureRoot` itself (guard before calling
  `reconstructRoot`).

In practice this branch is effectively dead code (store sets both fields together), so it is
purely defensive — but the plan text as written is not directly implementable inside a
non-null-returning sync helper. Worth pinning so the implementer doesn't return a synthesized
object with a `null`/`undefined` id.

### 2. Characterization test must use the real store's `setRoot`, not a bare `getRoot` stub
Task 3's characterization test offers "use the real store's `setRoot`, **or** a stub returning
a state object." The stub alternative is unsafe: `reconstructRoot` reads `getRootId(userId)`
to build the id. If the test stubs only `getRoot` to return a state but leaves `getRootId`
returning `null`, the new falsy-`rootId` guard (Finding 1) sends it down the create path and
the "zero `repo.create` / zero `repo.save`" assertion fails. Recommend the plan commit to the
real-store `setRoot('u', '<id>', state)` path (which sets both fields) and drop the stub
option, to keep the fast path consistent.

### 3. Target test: `a.id === b.id` is not the RED discriminator — confirm reliance on create-count
Because both `repo.save` calls resolve to the same `makeSession({ id: 'root-1' })` mock,
`a.id === b.id === 'root-1'` holds **even in the RED (pre-lock) state**. The real RED signal
is `repo.create`/`repo.save` called **once** (pre-lock: twice). The plan already asserts the
call counts, so this is fine — just flagging that the id-equality assertion alone would give a
false GREEN. Keep the call-count assertions as the primary guard.

### 4. Existing regression coverage — confirmed safe
`multi-session-lifecycle.spec.ts:726-759` ("create exactly one root … and reuse it on repeat
calls") drives `ensureRoot` twice and asserts no second `save` and matching ids. The refactor
preserves the fast path, so this stays GREEN. Verified the spec constructs the engine with the
same 4-arg signature the plan reuses. No anti-target inversion needed.

## Scope Note (accepted design, not a defect)

The in-process `Map` lock collapses only **simultaneous** creates within one Node process. It
does not serialize across multiple API instances. The plan and roadmap explicitly accept this
(no DB unique index; multiple roots over time are legitimate; janitor reaps orphans). For the
current single-instance deployment this is correct; if the API is ever horizontally scaled,
the duplicate-root race reopens and would need a DB-level guard. Flagging for future awareness
only — no action required for this task.

## Conclusion

No missing migrations, no wrong file paths, no incorrect API usage, no architectural or
security issues. The four findings are clarifications that will smooth implementation but do
not block it. Address Findings 1 and 2 in the plan text (or trust the implementer to resolve
them) before implementation.
