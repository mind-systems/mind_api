# Plan: proto/auth.proto

## Context
Define the gRPC service contract for the auth domain — the first `.proto` file in the project. This is a contract-only milestone: no code generation, no gRPC transport wiring, no controller changes.

## Settings
- Testing: no
- Logging: no
- Docs: no

## Tasks

### Phase 1: Proto file

- [x] **Task 1: Create proto/auth.proto with shared types**
  Files: `proto/auth.proto`
  Create the `proto/` directory at project root and the `auth.proto` file.
  Header: `syntax = "proto3"; package mind;` (all proto files in this project share the same package — see roadmap).
  Add `option go_package` only if needed by consumers later; for now keep options minimal.

  Define shared types that map to existing entities/DTOs:

  - `enum UserRole` — `USER = 0; ADMIN = 1;` (maps to `UserRole` enum in `src/users/interfaces/user-role.enum.ts`)
  - `message UserDto` — `string id; string email; string name; UserRole role; string language;` (maps to `UserResponseDto` in `src/users/dto/auth-response.dto.ts`)
  - `message AuthResponse` — `UserDto user; string access_token;` (maps to `AuthResponseDto`; note: the REST API returns the token in the `Authorization` header, but gRPC has no response headers — the token goes in the message body)
  - `message TokenDto` — `string id; string name; string created_at; optional string last_used_at;` (maps to `TokenResponseDto`; timestamps as ISO-8601 strings for cross-language simplicity)

- [x] **Task 2: Add RPC request/response messages and AuthService definition**
  Files: `proto/auth.proto`
  In the same file, add all per-RPC messages and the service block.

  Request/response messages:

  - `message SendCodeRequest` — `string email; optional string locale;`
  - `message SendCodeResponse` — `string message;`
  - `message VerifyCodeRequest` — `string email; string code; optional string language;`
  - (response is `AuthResponse`)
  - `message GoogleAuthRequest` — `string server_auth_code; optional string language; optional string redirect_uri;`
  - (response is `AuthResponse`)
  - `message LogoutRequest` — empty (auth comes from metadata/interceptor, not the message)
  - `message LogoutResponse` — `string message;`
  - `message CreateTokenRequest` — `string name;`
  - `message CreateTokenResponse` — `string token; string id; string name; string created_at;` (the raw token is returned once, same as `CreateTokenResponseDto`)
  - `message ListTokensRequest` — empty
  - `message ListTokensResponse` — `repeated TokenDto tokens;`
  - `message DeleteTokenRequest` — `string id;`
  - `message DeleteTokenResponse` — `string message;`

  Service definition:

  ```protobuf
  service AuthService {
    rpc SendCode(SendCodeRequest) returns (SendCodeResponse);
    rpc VerifyCode(VerifyCodeRequest) returns (AuthResponse);
    rpc GoogleAuth(GoogleAuthRequest) returns (AuthResponse);
    rpc Logout(LogoutRequest) returns (LogoutResponse);
    rpc CreateToken(CreateTokenRequest) returns (CreateTokenResponse);
    rpc ListTokens(ListTokensRequest) returns (ListTokensResponse);
    rpc DeleteToken(DeleteTokenRequest) returns (DeleteTokenResponse);
  }
  ```

  Add a comment at the top of the service block noting that `GET /auth/google/callback` stays HTTP-only (browser redirect flow) and is not represented in gRPC.

  Cross-check every field name and optionality against the existing DTOs:
  - `SendCodeDto` → `email` (required), `locale` (optional) ✓
  - `VerifyCodeDto` → `email`, `code` (required), `language` (optional) ✓
  - `GoogleAuthDto` → `serverAuthCode` (required), `language` (optional), `redirectUri` (optional) ✓
  - `CreateTokenDto` → `name` (required) ✓
  - `TokenResponseDto` → `id`, `name`, `createdAt`, `lastUsedAt` (nullable) ✓
  - `CreateTokenResponseDto` → `token`, `id`, `name`, `createdAt` ✓
  - `UserResponseDto` → `id`, `email`, `name`, `role`, `language` ✓
