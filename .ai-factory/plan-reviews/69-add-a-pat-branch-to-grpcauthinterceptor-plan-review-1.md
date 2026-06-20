# Plan Review: Add a PAT branch to `GrpcAuthInterceptor`

**Plan:** `69-add-a-pat-branch-to-grpcauthinterceptor.md`
**Files Reviewed:** 5 (plan, interceptor, PAT service, auth module, breath-sessions module + roadmap/rules/note cross-check)
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** OK. The change keeps the modular-monolith boundaries intact — the interceptor consumes `PersonalAccessTokenService` strictly through `AuthModule`'s exports, never reaching into another module's internals. No `@InjectRepository` is added outside the owning module.
- **Rules (`RULES.md`):** OK. Task 2 explicitly forbids the non-null assertion (`!`) and relies on the `null`-narrowing after the `validateToken` check — matches the "NEVER use `!`" rule. Logging is set to "minimal" and the plan adds no logging, so the "no PII in logs" / "keep logs lean" rules are not at risk.
- **Roadmap (`ROADMAP.md`):** OK. The plan implements the open milestone at `ROADMAP.md:249` ("Add a PAT branch to `GrpcAuthInterceptor`") almost verbatim. **WARN (non-blocking):** the plan body does not cite the roadmap milestone or its spec note (`.ai-factory/notes/53-grpc-auth-pat-support.md`). Linkage is implicit only; adding the reference would aid traceability but is not required.

## Correctness Verification

I confirmed each load-bearing assumption against the codebase:

1. **`PersonalAccessTokenService` is exported** from `auth.module.ts` (it is in both `providers` and `exports`). ✓
2. **No module rewiring is needed — and this is provably safe.** `GrpcAuthInterceptor` already depends on `JwtService` and `SessionService`, both of which come only from `AuthModule`'s exports. Therefore *every* module that applies `@UseInterceptors(GrpcAuthInterceptor)` (12+ controllers) must already import `AuthModule`, otherwise current code would fail DI. Adding a third dependency that is *also* exported by `AuthModule` cannot break resolution in any module where the interceptor already resolves today. The plan's "do not add new module imports unless DI fails" guidance is correct, and DI will not fail. ✓
3. **Token format / hashing is consistent.** `create()` issues `pat_${randomBytes(32).toString('hex')}` and `validateToken()` hashes the *full* raw token including the `pat_` prefix. The interceptor strips `Bearer ` (line 40) and passes the full remaining `token` (still prefixed with `pat_`) to `validateToken`. Prefix detection (`token.startsWith('pat_')`) and the hash input are therefore aligned. ✓
4. **Type compatibility.** `validateToken` returns `JwtPayload | null` with exactly `{ sub, email, name }`, and `JwtPayload` (auth.interface.ts) declares exactly those three fields. Both branches can assign a single `let payload: JwtPayload`. ✓
5. **JWT/PAT branches cannot collide.** JWTs are base64url and begin with `eyJ`; they never start with `pat_`, so the prefix branch is unambiguous. ✓
6. **No proto/DTO/DB/migration work.** Entity, repository, and `validateToken` already exist; the change is auth logic in one file. ✓

## Critical Issues

None.

## Minor Notes (non-blocking)

- **Line-number drift:** Task 2 references "lines ~42-53" and "the current JWT logic". The current interceptor matches this (absent-token block at 42–53, JWT verify at 55–63, session check at 65–71). The "~" hedging is appropriate; just re-anchor on the code, not the numbers, during implementation.
- **Revocation still works for PATs:** worth noting for the implementer that PAT revocation is by row deletion (`revoke()` → `patRepo.delete`), so a revoked PAT makes `validateToken` return `null` → `UNAUTHENTICATED`. The plan's decision to skip `sessionService.isValid` does not weaken revocation. (No action needed — confirming the security posture is sound.)
- **Roadmap/spec linkage:** see Roadmap gate WARN above.

## Positive Notes

- The plan correctly identifies the subtle `@GrpcOptionalAuth()` invariant: optional auth bypasses **only on absent token**, and a present-but-invalid PAT must throw exactly like a present-but-invalid JWT. This is the one place a naive implementation would introduce a security hole (silently nulling an invalid PAT under optional auth), and the plan calls it out explicitly.
- Correctly mandates skipping both `jwtService.verifyAsync` and `sessionService.isValid` for the PAT branch — reusing the JWT/session path is precisely the latent bug, since PATs are not in `user_sessions`.
- Branch-on-prefix (rather than "try JWT, fall back to PAT") avoids a needless DB lookup on every JWT request and keeps error messages crisp.
- Error code/message for the invalid-PAT path is deliberately matched to the JWT-invalid path, avoiding an oracle that distinguishes token types.
- Pre-empts the `!` rule violation that the `JwtPayload | null` return type would otherwise invite.

PLAN_REVIEW_PASS
