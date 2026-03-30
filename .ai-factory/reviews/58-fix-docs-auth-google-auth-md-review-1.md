## Code Review: Fix `docs/auth/google-auth.md`

**Files changed:** 1 (`docs/auth/google-auth.md`)
**Risk Level:** 🟢 Low — docs-only change, no runtime impact

### Verification

All claims in the updated document verified against the codebase:

- `rpc GoogleAuth(GoogleAuthRequest) returns (AuthResponse)` — matches `proto/auth.proto:115`
- Proto fields `server_auth_code` (required), `language` (optional), `redirect_uri` (optional) — match `proto/auth.proto:63–67`
- `AuthResponse` with `user` (`UserDto`) and `access_token` — match `proto/auth.proto:27–30`
- `googleAuth` method in `auth.grpc.controller.ts:65` — no `@UseInterceptors(GrpcAuthInterceptor)`, correctly documented as public endpoint
- `UnauthorizedException` thrown by `GoogleTokenService` → mapped to `UNAUTHENTICATED` by `GrpcExceptionFilter` (HTTP 401 → `GrpcStatus.UNAUTHENTICATED` at `grpc-exception.filter.ts:16`) — error description accurate
- `GET /auth/google/callback` in `google-callback.controller.ts:11` — remains HTTP, correctly kept as-is
- `redirect_uri` validation — correctly attributed to Google's OAuth API, not server-side. The gRPC path has no class-validator pipeline (verified: `GoogleAuthDto` with `@Matches` decorator exists but is never imported)
- All file paths in the Implementation table verified to exist
- Russian language maintained throughout

### Critical Issues

None.

### Suggestions

**1. Inconsistent field naming between updated and untouched sections**

The updated sections use proto snake_case (`server_auth_code`, `redirect_uri`) while two untouched lines still use the old DTO camelCase:

- Line 3: "оба передают **`serverAuthCode`** на бэкенд" — should be `server_auth_code` to match line 7
- Line 15: "получает **`serverAuthCode`** напрямую от Google Sign-In SDK. Поле **`redirectUri`** не передаётся" — should be `server_auth_code` and `redirect_uri`

These lines were outside the plan's task scope but are in the same document and now create a naming inconsistency. Not blocking — the doc is still understandable — but worth a follow-up pass.

REVIEW_PASS
