# Review: proto/auth.proto

**Plan:** `.ai-factory/plans/01-proto-auth-proto.md`
**Scope:** `proto/auth.proto` (new file, 120 lines)

## Validation

- `protoc --proto_path=proto proto/auth.proto` — compiles with zero errors/warnings (libprotoc 34.0)

## Cross-check against existing DTOs

| Proto message / field | Source DTO / Entity | Match |
|---|---|---|
| `UserDto` (id, email, name, role, language) | `UserResponseDto` (id, email, name, role, language) | exact |
| `AuthResponse` (user, access_token) | `AuthResponseDto` (user, accessToken) | exact (snake_case convention) |
| `TokenDto` (id, name, created_at, last_used_at?) | `TokenResponseDto` (id, name, createdAt, lastUsedAt) | exact |
| `SendCodeRequest` (email, locale?) | `SendCodeDto` (email, locale?) | exact |
| `VerifyCodeRequest` (email, code, language?) | `VerifyCodeDto` (email, code, language?) | exact |
| `GoogleAuthRequest` (server_auth_code, language?, redirect_uri?) | `GoogleAuthDto` (serverAuthCode, language?, redirectUri?) | exact |
| `LogoutRequest` (empty) | controller extracts token from `req` | correct — identity via metadata |
| `CreateTokenRequest` (name) | `CreateTokenDto` (name) | exact |
| `CreateTokenResponse` (token, id, name, created_at) | `CreateTokenResponseDto` (token, id, name, createdAt) | exact |
| `ListTokensResponse` (repeated TokenDto) | `TokenResponseDto[]` | exact |
| `DeleteTokenRequest` (id) | controller param `id` | exact |
| `UserRole` enum (USER=0, ADMIN=1) | `UserRole` enum (USER='user', ADMIN='admin') | correct — int↔string mapping at transport layer |

## RPC coverage vs REST endpoints

| REST endpoint | Proto RPC | Notes |
|---|---|---|
| `POST /auth/send-code` | `SendCode` | — |
| `POST /auth/verify-code` | `VerifyCode` | — |
| `POST /auth/google` | `GoogleAuth` | — |
| `GET /auth/google/callback` | **not in proto** | correct — browser redirect, stays HTTP |
| `POST /auth/logout` | `Logout` | — |
| `POST /auth/tokens` | `CreateToken` | — |
| `GET /auth/tokens` | `ListTokens` | — |
| `DELETE /auth/tokens/:id` | `DeleteToken` | — |

Full coverage. No endpoint missed, no extra RPC added.

## Observations (non-blocking)

1. **Timestamps as ISO-8601 strings** — `created_at`, `last_used_at`, `created_at` in `CreateTokenResponse` use `string` instead of `google.protobuf.Timestamp`. This is a deliberate design choice documented in the plan ("cross-language simplicity"). Acceptable; keeps the proto free of `import "google/protobuf/timestamp.proto"`.

2. **`message` as a field name** — `SendCodeResponse.message`, `LogoutResponse.message`, `DeleteTokenResponse.message` use the word `message` as a field name. This is valid proto3 (protoc compiles it, the keyword is unambiguous in field-name position). Some proto linters may flag it stylistically, but it accurately reflects the REST response shape `{ message: string }`.

3. **Empty request messages** — `LogoutRequest` and `ListTokensRequest` are custom empty messages rather than `google.protobuf.Empty`. This is the recommended practice: own messages can be extended later without breaking clients.

4. **`optional` keyword** — used for nullable/optional fields (`locale`, `language`, `redirect_uri`, `last_used_at`). Requires protobuf 3.15+ for presence tracking. `libprotoc 34.0` is well above this threshold, and Dart/TS generators support it.

## Critical issues

None.

REVIEW_PASS
