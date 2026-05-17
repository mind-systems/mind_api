# Plan Review: PersonalAccessTokenService spec

**Plan file:** `66-personalaccesstokenservice-spec.md`
**Target file:** `src/users/service/personal-access-token.service.spec.ts`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md:** OK — the target spec sits inside the `users` module next to its sibling specs (`auth.service.spec.ts`, `session.service.spec.ts`, `google-token.service.spec.ts`, `user.service.spec.ts`). No module-boundary concerns; the test only constructs the service with mocked repositories.
- **RULES.md:** OK — the rules cover non-null assertions, log hygiene, and gRPC `@Payload()` usage. None of them constrain pure unit-test design. The spec author should still avoid leaking real tokens or hashes into logs, but the plan doesn't introduce any logging.
- **ROADMAP.md:** N/A — this is a focused test-coverage task with no production behavior change.

## Plan vs. Implementation Cross-check

I read `src/users/service/personal-access-token.service.ts` and verified every behavior the plan asserts:

| Plan claim | Implementation | Match |
|---|---|---|
| Token shape `/^pat_[0-9a-f]{64}$/` | `` `pat_${randomBytes(32).toString('hex')}` `` produces 32 bytes → 64 hex chars | ✅ |
| Response shape `{ token, id, name, createdAt }`, no `tokenHash` | Return literal in `create()` lines 30–35 | ✅ |
| `patRepo.create({ userId, tokenHash, name })` with SHA-256 hash | Line 28; `hash()` uses `createHash('sha256')...digest('hex')` | ✅ |
| Saved `id`/`createdAt` propagated to response | Lines 32–34 read from `saved` | ✅ |
| `list()` options `{ where: { userId }, order: { createdAt: 'DESC' }, select: ['id','name','createdAt','lastUsedAt'] }` | Lines 39–43 | ✅ |
| `revoke()` calls `patRepo.delete({ id, userId })` and throws `NotFoundException` when `!result.affected` | Lines 46–50 — both `affected: 0` and `affected: undefined` satisfy `!result.affected` | ✅ |
| `validateToken()` looks up by `tokenHash` hash | Lines 54–55 | ✅ |
| Null on missing PAT, null on missing user (orphan, no throw) | Lines 56–63 | ✅ |
| Success returns `{ sub: user.id, email: user.email, name: user.name }` and updates `lastUsedAt` via `patRepo.update({ id: pat.id }, { lastUsedAt: ... })` | Lines 65–67 | ✅ |
| `JwtPayload` uses `sub` (not `id`) | `src/users/interfaces/auth.interface.ts` confirms | ✅ |

## Conventions

- Sibling spec `session.service.spec.ts` already shows the established pattern: build the service with `new SessionService(repo, emitter)`, mock the repo with `jest.fn()`s, and re-derive expected hashes with a local `hash = (t) => createHash('sha256').update(t).digest('hex')` helper. Plan tasks 2 and 5 require exactly this approach and will fit cleanly.
- Test command `npx jest src/users/service/personal-access-token.service.spec.ts` matches the project convention documented in `CLAUDE.md`.

## Critical Issues

None.

## Minor Notes (non-blocking)

- Task 2 asserts the captured `tokenHash` argument equals `sha256(returnedToken)`. The implementation derives `tokenHash` *before* `patRepo.create()` is called, so the test must mock `patRepo.create()` to return *something* (e.g. an echo of its input or a stub entity) and then `patRepo.save()` to resolve with a fixture that carries `id`/`createdAt`. This is implicit in the plan ("mock `patRepo.save` to resolve with a known id/createdAt") but the spec author should not forget to also stub `patRepo.create()` — without it the chain `patRepo.save(entity)` receives `undefined`. Worth being explicit in the test scaffolding step, but not a plan defect.
- Task 6's "should NOT throw when the associated user is missing" overlaps with "should return null when userRepo.findOne() resolves to null". Both are fine to keep — the explicit no-throw assertion documents the orphan-safety invariant.

## Positive Notes

- Clear phase decomposition (one phase per public method) makes the test suite trivially navigable.
- Plan explicitly enforces the most important security invariants: raw token never persisted, ownership scope on `delete`, no crash on orphaned tokens, `lastUsedAt` only on success.
- Regex assertion `/^pat_[0-9a-f]{64}$/` is precise — catches accidental prefix/encoding regressions.
- Plan distinguishes `affected: 0` and `affected: undefined` to exercise the `!result.affected` branch, which is correct branch coverage.

PLAN_REVIEW_PASS
