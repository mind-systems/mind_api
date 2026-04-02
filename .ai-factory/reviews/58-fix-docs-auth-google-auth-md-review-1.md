## Code Review: Fix `docs/auth/google-auth.md`

**Files Reviewed:** 1 (`docs/auth/google-auth.md`)
**Risk Level:** 🟢 Low — docs-only change, no runtime impact

### Context Gates

- **ARCHITECTURE.md:** WARN — no architectural concerns; docs-only change, no code affected.
- **RULES.md:** WARN — no code changes; non-null assertion and logging rules are not applicable.
- **ROADMAP.md:** WARN — Phase 12 roadmap item for `docs/auth/google-auth.md` is correctly marked `[x]`. Aligned.

### Critical Issues

None.

### Suggestions

**1. Inconsistent field naming between updated and untouched lines**

The updated sections correctly use proto snake_case (`server_auth_code`, `redirect_uri`), but two untouched lines still use the old DTO camelCase, creating a naming inconsistency within the same document:

- **Line 3:** `оба передают **serverAuthCode** на бэкенд` — should be `server_auth_code` to match lines 7, 35, 44.
- **Line 15:** `получает **serverAuthCode** напрямую от Google Sign-In SDK. Поле **redirectUri** не передаётся` — should be `server_auth_code` and `redirect_uri` to match lines 19, 37.

These lines were outside the plan's explicit task scope (Tasks 1-4 targeted lines 5-11, 19, 31-54, 62-64), but they refer to the same proto fields and now contradict the updated sections.

### Positive Notes

- All technical claims verified against the codebase:
  - `rpc GoogleAuth(GoogleAuthRequest) returns (AuthResponse)` matches `proto/auth.proto:115`
  - Proto fields `server_auth_code` (required), `language` (optional), `redirect_uri` (optional) match `proto/auth.proto:63-67`
  - `AuthResponse` with `user` (`UserDto`) and `access_token` matches `proto/auth.proto:27-30`
  - `googleAuth` method in `auth.grpc.controller.ts:65` has no `@UseInterceptors(GrpcAuthInterceptor)` — correctly documented as public endpoint
  - `UnauthorizedException` thrown by `GoogleTokenService` maps to `UNAUTHENTICATED` via `GrpcExceptionFilter` (`grpc-exception.filter.ts:16`) — error status accurate
  - `GET /auth/google/callback` in `google-callback.controller.ts:11` remains HTTP — correctly preserved as-is
  - `redirect_uri` validation correctly attributed to Google's OAuth API, not server-side (gRPC path has no class-validator pipeline)
- All file paths in the Implementation table verified to exist
- Dead DTO reference (`google-auth.dto.ts`) correctly replaced with proto source of truth
- Controller row correctly split into gRPC (`auth.grpc.controller.ts`) and HTTP relay (`controller/google-callback.controller.ts`)
- Russian language maintained throughout the document
