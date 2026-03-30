## Plan Review: Fix `docs/auth/google-auth.md`

**Files in scope:** 1
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md:** WARN — no architectural concerns; this is a docs-only change.
- **RULES.md:** WARN — no code changes, rules about non-null assertions / logging are not applicable.
- **ROADMAP.md:** WARN — the plan addresses the roadmap item for `docs/auth/google-auth.md` (Phase 12) but only partially — see Critical Issues.

### Critical Issues

**1. Plan scope is too narrow — stale HTTP references remain throughout the document**

The plan only fixes the Implementation table (line 64) and explicitly says "Keep the rest of the file unchanged." However, the document has multiple stale `POST /auth/google` HTTP references that become incorrect after the gRPC migration (Phase 4.1 deleted HTTP controllers):

- **Line 7** ("Как устроен вход"): "Клиент отправляет `POST /auth/google` с `serverAuthCode`" — now a gRPC `googleAuth` call, not HTTP POST.
- **Line 9**: "токен в заголовке `Authorization: Bearer <token>` и `UserResponseDto` в теле" — gRPC returns `AuthResponse` proto message with `access_token` field; auth for subsequent gRPC calls uses metadata, not HTTP headers.
- **Line 19** ("Браузерный flow"): "Клиент затем вызывает `POST /auth/google`" — same stale HTTP reference.
- **Lines 33–44** (the entire "Эндпоинты" `POST /auth/google` block): describes HTTP verb, JSON body, status codes `200 OK` / `401 Unauthorized` — all HTTP-specific. The actual interface is now `rpc GoogleAuth(GoogleAuthRequest) returns (AuthResponse)` with gRPC status codes (`UNAUTHENTICATED`, not `401`).

The `GET /auth/google/callback` block (lines 46–54) is still correct — that endpoint remains HTTP in `google-callback.controller.ts`.

Previous Phase 12 doc fixes (sync, breath-sessions) updated the entire document when the transport changed from WebSocket/HTTP to gRPC. This plan should follow the same pattern.

**Recommended fix:** Add tasks to update the body text and the Эндпоинты section to reflect gRPC terminology. The `GET /auth/google/callback` HTTP block stays as-is. The `POST /auth/google` block should be rewritten as a gRPC method description.

### Suggestions

None beyond the critical issue above. The Implementation table replacement itself is correct:
- File paths verified: `src/users/auth.grpc.controller.ts` exists with `googleAuth` method (line 65), `src/users/controller/google-callback.controller.ts` exists with `GET auth/google/callback` (line 11).
- All other files in the table (`google-token.service.ts`, `google-profile.interface.ts`, `google-auth.dto.ts`, `auth.service.ts`) verified to exist.
- Language is correctly maintained in Russian.

### Positive Notes

- The plan correctly identifies the two-controller split (gRPC for auth, HTTP for callback relay).
- Replacement row descriptions are accurate and concise.
- The plan correctly notes to keep the doc in Russian.
