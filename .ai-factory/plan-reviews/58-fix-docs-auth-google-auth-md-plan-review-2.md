## Plan Review: Fix `docs/auth/google-auth.md` (iteration 2)

**Files in scope:** 1
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no architectural concerns; docs-only change.
- **RULES.md:** WARN — no code changes; rules about non-null assertions / logging are not applicable.
- **ROADMAP.md:** WARN — plan addresses the Phase 12 roadmap item for `docs/auth/google-auth.md`. Aligned.

### Previous Review

Review 1 flagged that the plan only updated the Implementation table while leaving stale HTTP references throughout the document body and endpoints section. This iteration addresses all of those — Tasks 1–3 now rewrite the body text and endpoints section. The scope issue is resolved.

### Critical Issues

**1. Implementation table row for `google-auth.dto.ts` (line 62) is stale — not addressed by any task**

Task 4 replaces the last row (line 64) but the table also contains:

```
| `src/users/dto/google-auth.dto.ts` | DTO запроса (`serverAuthCode`, `language`, `redirectUri`) |
```

`GoogleAuthDto` is dead code — it is defined in the file but never imported anywhere in the codebase. The gRPC controller uses `GoogleAuthRequest` from `proto/generated/auth.ts` directly. Documenting a dead DTO as the request contract is misleading.

**Fix:** Replace the row with a reference to the proto definition:

```
| `proto/auth.proto` → `GoogleAuthRequest` | gRPC-сообщение запроса (`server_auth_code`, `language`, `redirect_uri`) |
```

Or remove the row entirely if the dead DTO file is also planned for deletion.

### Suggestions

**1. `redirect_uri` validation claim is no longer enforced server-side**

Task 3 says `redirect_uri` "must be a valid URI". This was only enforced by the `@Matches` decorator in the old HTTP `GoogleAuthDto` — which is now dead code. The gRPC path receives the proto `GoogleAuthRequest` with no class-validator pipeline. An invalid URI will still cause failure (Google's OAuth API rejects it, resulting in `UNAUTHENTICATED`), but the server itself doesn't validate the format.

The doc should either drop the "must be a valid URI" claim or rephrase it as a semantic requirement: "Google rejects invalid URIs during token exchange."

### Positive Notes

- The plan correctly expanded scope to cover all HTTP→gRPC references in the document body and endpoints section, addressing the first review's critical issue.
- Task 3 accurately describes the proto contract: method signature, field names, optionality, and error status all match `proto/auth.proto` and the `GrpcExceptionFilter` mapping (`UnauthorizedException` → `UNAUTHENTICATED`).
- Task 4 correctly splits the single controller row into two rows matching the actual code: `auth.grpc.controller.ts` (gRPC) and `controller/google-callback.controller.ts` (HTTP relay). Both file paths verified.
- The `GET /auth/google/callback` HTTP block is correctly kept as-is — the endpoint remains HTTP in `google-callback.controller.ts`.
- All line number references in the plan match the current state of the document.
- Language correctly maintained in Russian for the doc content.
