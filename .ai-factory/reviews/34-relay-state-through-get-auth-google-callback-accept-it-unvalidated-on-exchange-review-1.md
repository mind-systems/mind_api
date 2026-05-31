# Code Review — Relay OAuth `state` through Google sign-in (backend half)

**Scope reviewed:** `src/users/controller/google-callback.controller.ts`, `src/users/dto/google-code-exchange.dto.ts`
**Diff base:** `git diff HEAD`

## Summary

The change matches the spec (`.ai-factory/notes/19-spec-oauth-state-relay-backend.md`) exactly and is a clean, minimal, transparent relay of the OAuth `state` parameter. All three tasks implemented correctly:

1. `startGoogleOAuth` accepts `@Query('state')` and conditionally spreads it into the Google auth `URLSearchParams`.
2. `googleCallback` accepts `@Query('state')`, and both the error and success redirects are rebuilt with `URLSearchParams`, appending `state` only when present.
3. `GoogleCodeExchangeDto` gains an optional, unvalidated `state?: string` field.

## Correctness

- **NestJS param ordering** — `startGoogleOAuth` now lists `@Query('state')` before `@Res()`. Parameter decorators bind by decorator, not position, so the reorder is safe; `res` is still injected correctly.
- **Type narrowing** — In the success branch, `code` is typed `string | undefined` but the preceding `if (error || !code) return …` guard narrows it to `string`, so `{ googleCode: code }` satisfies the `Record<string, string>` shape `URLSearchParams` expects. Compiles clean.
- **No redeclaration conflict** — The first `const params` is block-scoped inside the `if`, the second is at function-body scope after the guard returns. No shadowing issue.
- **Empty-string `state`** — `...(state ? { state } : {})` drops an empty-string `state` (falsy). Consistent with the spec's "only when present" and harmless for a relay.
- **Encoding equivalence** — The old code used `encodeURIComponent`; the new code uses `URLSearchParams.toString()`. The only difference is space encoding (`%20` vs `+`), but since the SPA reads these back via `URLSearchParams`, the round-trip is lossless (verified: `state`/`googleCode` decode identically). No behavioral regression for the relayed `googleCode`/`googleError`.

## Security

- **No open redirect** — The redirect host/path are fixed from the trusted `APP_BASE_URL` config; `state` is appended only as a query value via `URLSearchParams`, which percent-encodes it. It cannot alter the host or path.
- **No header/CRLF injection** — `URLSearchParams` encodes `\r`/`\n` (and `&`, `/`, `+`), so a malicious `state` cannot inject into the `Location` header or forge extra params.
- **Unvalidated `state` is by design** — The SPA owns generation/validation; the backend only relays. The DTO field exists solely to pass `forbidNonWhitelisted`. The `exchangeGoogleCode` / `signInWithGoogle` / `redirectUri` allow-list paths were correctly left untouched.

## Build

`npx tsc --noEmit` produces no errors in the changed files. The only type errors reported are pre-existing and unrelated (`src/realtime/services/biometric-stream-engine.service.spec.ts`).

## Notes (non-blocking)

- Backend is a no-op until the `mind_web` counterpart ships, as the spec states. Confirm the SPA change lands together to actually close the login-CSRF gap.

REVIEW_PASS
