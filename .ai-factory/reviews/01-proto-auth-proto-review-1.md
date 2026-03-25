# Review: proto/auth.proto

**Plan:** `.ai-factory/plans/01-proto-auth-proto.md`
**Scope:** `proto/auth.proto` (new file, 120 lines) + roadmap checkbox update

## Code Review Summary

**Files Reviewed:** 2 (`proto/auth.proto`, `.ai-factory/ROADMAP.md`)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — `WARN` (informational). Proto files live in `proto/` at project root, outside the `src/` module structure described in ARCHITECTURE.md. This is correct — proto files are contracts, not application code. No violation.
- **RULES.md** — PASS. No runtime code; no `!` operator, no logging, no sensitive data.
- **ROADMAP.md** — PASS. The `proto/auth.proto` roadmap item is correctly checked `[x]`. All RPCs and types listed in the roadmap line are present in the proto file.

### Cross-check: Proto fields vs existing DTOs

| Proto message / field | Source DTO / Entity | Match |
|---|---|---|
| `UserRole` (USER=0, ADMIN=1) | `UserRole` enum (USER='user', ADMIN='admin') | correct — int↔string mapping at transport layer |
| `UserDto` (id, email, name, role, language) | `UserResponseDto` (id, email, name, role, language) | exact |
| `AuthResponse` (user, access_token) | `AuthResponseDto` (user, accessToken) | exact (snake_case proto convention) |
| `TokenDto` (id, name, created_at, last_used_at?) | `TokenResponseDto` (id, name, createdAt: Date, lastUsedAt: Date\|null) | exact — timestamps as ISO-8601 strings per plan |
| `SendCodeRequest` (email, locale?) | `SendCodeDto` (email, locale?) | exact |
| `VerifyCodeRequest` (email, code, language?) | `VerifyCodeDto` (email, code, language?) | exact |
| `GoogleAuthRequest` (server_auth_code, language?, redirect_uri?) | `GoogleAuthDto` (serverAuthCode, language?, redirectUri?) | exact |
| `LogoutRequest` (empty) | controller extracts token from `req` | correct — auth via metadata |
| `CreateTokenRequest` (name) | `CreateTokenDto` (name) | exact |
| `CreateTokenResponse` (token, id, name, created_at) | `CreateTokenResponseDto` (token, id, name, createdAt) | exact |
| `ListTokensResponse` (repeated TokenDto) | `TokenResponseDto[]` | exact |
| `DeleteTokenRequest` (id) | controller `@Param('id')` | exact |

### RPC coverage vs REST endpoints

| REST endpoint | Proto RPC | Status |
|---|---|---|
| `POST /auth/send-code` | `SendCode` | covered |
| `POST /auth/verify-code` | `VerifyCode` | covered |
| `POST /auth/google` | `GoogleAuth` | covered |
| `GET /auth/google/callback` | **not in proto** | correct — browser redirect, stays HTTP-only (documented in proto comment) |
| `POST /auth/logout` | `Logout` | covered |
| `POST /auth/tokens` | `CreateToken` | covered |
| `GET /auth/tokens` | `ListTokens` | covered |
| `DELETE /auth/tokens/:id` | `DeleteToken` | covered |

Full coverage. No endpoint missed, no extra RPC added.

### Proto syntax verification

- Field numbers: sequential (1-based), no gaps, no collisions across all 15 messages
- `optional` keyword: correctly applied to nullable/optional fields (locale, language, redirect_uri, last_used_at) — requires protobuf 3.15+, compatible with modern protoc
- Empty request messages (`LogoutRequest`, `ListTokensRequest`): custom messages rather than `google.protobuf.Empty` — correct practice for future extensibility
- `UserRole` enum without `*_UNSPECIFIED = 0` sentinel: the enum is only used in server-to-client response messages (`UserDto`), so the proto3 default-value ambiguity (where an unset field reads as `USER`) is not a practical concern

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- Clean, well-commented proto with source-file mapping annotations on every type
- AuthResponseDto's header-vs-body token difference is clearly documented
- Google callback exclusion is explicitly commented in the service block
- Consistent section-separator style that provides good readability
- Timestamps as ISO-8601 strings is a pragmatic choice that avoids `google.protobuf.Timestamp` import while maintaining cross-language simplicity

REVIEW_PASS
