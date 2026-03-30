# Plan: Fix `docs/auth/google-auth.md`

## Context
The Google auth document still describes the old HTTP transport (`POST /auth/google`, HTTP status codes, `Authorization` header). After the gRPC migration (Phase 4.1), the main auth endpoint is now `rpc GoogleAuth(GoogleAuthRequest) returns (AuthResponse)` in `auth.grpc.controller.ts`. The callback relay (`GET /auth/google/callback`) remains HTTP. The entire document needs to reflect this split. Additionally, the Implementation table references a dead DTO (`google-auth.dto.ts`) that should point to the proto definition instead.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Update document body to reflect gRPC transport

- [x] **Task 1: Update "Как устроен вход" section (lines 5–11)**
  Files: `docs/auth/google-auth.md`
  Replace all HTTP references in this section:
  - Line 7: change `POST /auth/google` → gRPC-вызов `GoogleAuth` with `GoogleAuthRequest`.
  - Line 9: change `токен в заголовке Authorization: Bearer <token> и UserResponseDto в теле` → сервер возвращает `AuthResponse` с полями `user` и `access_token`; для последующих gRPC-вызовов токен передаётся через metadata.
  Keep the rest of the section logic (server-side token exchange, profile extraction, auto-registration) unchanged. Maintain Russian language.

- [x] **Task 2: Update "Браузерный flow" section (line 19)** (depends on Task 1)
  Files: `docs/auth/google-auth.md`
  Line 19 says "Клиент затем вызывает `POST /auth/google`" — change to gRPC-вызов `GoogleAuth` with `redirect_uri` in `GoogleAuthRequest`. The callback relay part (`GET /auth/google/callback` redirecting via `APP_BASE_URL`) stays unchanged.

- [x] **Task 3: Rewrite "Эндпоинты" section (lines 31–54)** (depends on Task 2)
  Files: `docs/auth/google-auth.md`
  Replace the `POST /auth/google` block (lines 33–44) with a gRPC method description:
  - Method: `rpc GoogleAuth(GoogleAuthRequest) returns (AuthResponse)`
  - Request fields: `server_auth_code` (required), `language` (optional), `redirect_uri` (optional, only for browser flow — Google отклоняет невалидные URI при обмене кода на токены)
  - Response: `AuthResponse` with `user` (`UserDto`) and `access_token`
  - Error: gRPC status `UNAUTHENTICATED` for invalid or expired `serverAuthCode`
  Note: do NOT claim server-side URI format validation — the gRPC path has no class-validator pipeline. Invalid URIs are rejected by Google's OAuth API during token exchange, not by the server itself.
  Keep the `GET /auth/google/callback` block (lines 46–54) as-is — it remains an HTTP endpoint in `google-callback.controller.ts`.

- [x] **Task 4: Update the "Реализация" table (lines 62–64)** (depends on Task 3)
  Files: `docs/auth/google-auth.md`
  Two changes in this table:
  1. Replace the stale DTO row (line 62):
     ```
     | `src/users/dto/google-auth.dto.ts` | DTO запроса (`serverAuthCode`, `language`, `redirectUri`) |
     ```
     with a reference to the proto definition:
     ```
     | `proto/auth.proto` → `GoogleAuthRequest` | gRPC-сообщение запроса (`server_auth_code`, `language`, `redirect_uri`) |
     ```
     `GoogleAuthDto` is dead code — defined but never imported by any controller. The gRPC controller uses `GoogleAuthRequest` from `proto/generated/auth.ts` directly. The proto definition is the actual request contract.
  2. Replace the last row (line 64):
     ```
     | `src/users/auth.controller.ts` | `POST /auth/google`, `GET /auth/google/callback` |
     ```
     with two rows:
     ```
     | `src/users/auth.grpc.controller.ts` | gRPC-метод `googleAuth` (замена `POST /auth/google`) |
     | `src/users/controller/google-callback.controller.ts` | `GET /auth/google/callback` — HTTP relay для браузерного OAuth flow |
     ```
