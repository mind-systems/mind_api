# Code Review: Add a PAT branch to `GrpcAuthInterceptor`

**Plan:** `69-add-a-pat-branch-to-grpcauthinterceptor.md`
**Files reviewed:** `src/grpc/grpc-auth.interceptor.ts` (logic change), `src/main.ts` (cosmetic), plus cross-checks against `auth.module.ts`, `personal-access-token.service.ts`, `auth.interface.ts`, `app.module.ts`, and consuming controller modules.
**Risk level:** 🟢 Low

## Summary

The change adds a `pat_`-prefix branch to `GrpcAuthInterceptor.intercept` that validates Personal Access Tokens via the injected `PersonalAccessTokenService.validateToken`, bypassing `jwtService.verifyAsync` and `sessionService.isValid` (PATs are not session-backed). The JWT branch is unchanged. The implementation matches the plan and spec note exactly.

## Correctness verification

1. **DI wiring is sound.** `PersonalAccessTokenService` is in both `providers` and `exports` of `AuthModule` (`auth.module.ts:55,65`). `GrpcAuthInterceptor` is context-scoped via `@UseInterceptors(GrpcAuthInterceptor)` on controllers (not the global `APP_INTERCEPTOR`, which is `GrpcTraceContextInterceptor`). Constructor deps for context-scoped interceptors resolve from the host controller's module. Since the interceptor already injected `JwtService` and `SessionService` — both only available via `AuthModule`'s exports — every consuming module must already import `AuthModule` (confirmed e.g. `breath-sessions.module.ts:14`). Adding a third dependency that `AuthModule` also exports cannot break resolution anywhere the interceptor already worked. No module rewiring needed. ✓
2. **Token/prefix/hash alignment.** `create()` issues `pat_${randomBytes(32).toString('hex')}`; `validateToken()` sha256-hashes the full raw token *including* the `pat_` prefix. The interceptor strips only `Bearer ` (line 42) and passes the full remaining `pat_...` token to `validateToken`. Prefix detection and hash input are consistent. ✓
3. **No JWT/PAT branch collision.** JWTs are base64url and begin with `eyJ`; they never start with `pat_`. The prefix branch is unambiguous, and JWT validation behavior is byte-for-byte unchanged. ✓
4. **Type safety / no `!`.** `validateToken` returns `JwtPayload | null`. The explicit `=== null` guard narrows `patPayload` to `JwtPayload` before assignment to `payload`; no non-null assertion is used. Complies with the project `RULES.md` "NEVER use `!`" rule. The `{ sub, email, name }` shape returned matches `JwtPayload`. ✓
5. **`@GrpcOptionalAuth()` semantics preserved.** The absent-token bypass remains the only place auth is skipped (lines 44–55). A present-but-invalid PAT falls through to the PAT branch and throws `UNAUTHENTICATED`, exactly mirroring the present-but-invalid JWT path — no silent nulling. ✓
6. **Revocation intact.** PAT revocation deletes the row (`revoke()` → `patRepo.delete`), so a revoked PAT yields `validateToken === null` → `UNAUTHENTICATED`. Skipping `sessionService.isValid` does not weaken revocation. ✓
7. **No information-leak oracle.** The invalid-PAT error code/message (`UNAUTHENTICATED / "Invalid authorization token"`) is identical to the JWT-invalid path, so the response does not reveal which token type was supplied. ✓
8. **No logging added** — consistent with the plan's "minimal" setting and the no-PII logging rule. ✓
9. **`main.ts` change** is a Prettier reflow of the `keepaliveTimeMs` assignment onto one line — no behavioral change. ✓

## Runtime risk check

- No proto/DTO/entity/migration changes — the entity, repository, and `validateToken` already exist. Nothing to migrate.
- No new async race conditions: the PAT branch is a single awaited lookup with its own `lastUsedAt` update, identical in shape to the existing session-update side effect.
- `metadata.get('authorization')[0]?.toString()` and the `!token` guard already handle missing/empty tokens before either branch runs.

## Findings

None.

REVIEW_PASS
