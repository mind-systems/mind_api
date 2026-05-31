# Plan Review: Relay OAuth `state` through Google sign-in flow (backend half)

**Plan:** `34-relay-state-through-get-auth-google-callback-accept-it-unvalidated-on-exchange.md`
**Files Reviewed:** plan + 2 target source files + spec note 19 + context gates
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** WARN-free. All edits stay inside the `users` feature module (`controller/` + `dto/`). No cross-module imports, no boundary violation. Aligned with the Modular Monolith pattern.
- **Rules (`RULES.md`):** WARN-free. Relevant rules:
  - *Never log sensitive data* — the plan does not add or change any logging; the `state` value is never logged (Task 2 explicitly preserves the existing warn/success logs and adds nothing). ✓
  - *No non-null assertion* — not introduced. ✓
- **Roadmap (`ROADMAP.md`):** Linked. The plan maps directly to **Phase 26** (line 119): "Relay `state` through `GET /auth/google` + callback; accept it (unvalidated) on exchange." Full spec is `.ai-factory/notes/19-spec-oauth-state-relay-backend.md`, which the plan follows faithfully.

## Verification Against Codebase

All assumptions in the plan were checked against the actual source:

- **Task 1** — `startGoogleOAuth(@Res() res: Response)` exists at line 51 and builds a `new URLSearchParams({...})` (lines 55–60). Adding `@Query('state') state?: string` and spreading `...(state ? { state } : {})` is type-safe (`URLSearchParams` constructor accepts `Record<string,string>`). `@Query` is already imported (line 10). ✓
- **Task 2** — `googleCallback` currently uses manual string concatenation with `encodeURIComponent` (lines 41, 46). The `error || !code` branch (line 36), warn log (line 37), and success log (line 44) are correctly identified for preservation. Switching to `URLSearchParams` is sound. ✓
- **Task 3** — `GoogleCodeExchangeDto` already imports `IsString` and `IsOptional` (line 1), and follows the exact pattern of the existing optional `language?` field (lines 15–17). No new imports needed. ✓

## Critical Issues

None.

## Notes / Observations

- **`forbidNonWhitelisted` premise confirmed.** Task 3's stated rationale — the DTO field is needed so the POST body passes whitelist validation — is correct: `src/main.ts:80-82` enables `whitelist: true` + `forbidNonWhitelisted: true`. Without the field, a `state` property in the POST body would be rejected with a 400 (not silently stripped). So the field is genuinely required if the SPA sends `state` on exchange, and harmless otherwise.
- **No migration / no proto.** Correctly scoped out — no entity, enum, or `.proto` is touched. Matches spec note 19 §Scope.
- **Minor encoding behavior change (non-issue).** `URLSearchParams.toString()` encodes spaces as `+` rather than `%20`. For `googleCode` / `googleError` / `state` values this is irrelevant, and the SPA reads them via standard query parsing which decodes both forms. No action needed.
- **Cross-repo coordination.** Spec note 19 and the roadmap both state this backend half is a no-op until the `mind_web` counterpart (`mind_web/.ai-factory/notes/13-oauth-state-csrf-requirements.md`) ships. This is documented context, not a plan defect.

## Positive Notes

- Plan tracks the source spec (note 19) step-for-step, including the explicit "backend never validates `state`" guard and the instruction not to touch `signInWithGoogle` / the `redirectUri` allow-list.
- File paths, parameter decorators, and existing-code references are all accurate.
- Task dependencies (1 → 2 → 3) are correctly ordered and minimal.
- Scope is tight and security-aware: the relay-only design keeps CSRF ownership with the SPA, which is the architecturally correct split for a cookieless backend.

PLAN_REVIEW_PASS
