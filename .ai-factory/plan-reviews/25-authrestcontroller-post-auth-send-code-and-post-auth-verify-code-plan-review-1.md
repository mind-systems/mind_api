# Plan Review: AuthRestController — `POST /auth/send-code` and `POST /auth/verify-code`

**Plan:** `.ai-factory/plans/25-authrestcontroller-post-auth-send-code-and-post-auth-verify-code.md`
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. Auth endpoints (`send-code`, `verify-code`) are explicitly called out at line 98 as public/no-guard. Plan complies. Modular boundary respected — controller stays inside `AuthModule` and uses an injected `AuthCodeService`.
- **Rules (`.ai-factory/RULES.md`):** PASS. Plan explicitly forbids request/response logging and lets exceptions bubble through Nest's default filter — no PII leak, no entry/exit noise.
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS. Milestone at `ROADMAP.md:81` matches the plan's scope verbatim (controller path, route prefix, return shapes, public-endpoint requirement, `AuthCodeService` export check).

## Codebase Verification

Cross-checked every claim the plan makes against the actual files:

| Claim | Verified |
|---|---|
| `AuthCodeService.sendCode(email, locale)` signature | ✅ `src/users/service/auth-code.service.ts:35` — `sendCode(email: string, rawLocale?: string): Promise<void>` |
| `AuthCodeService.verifyCode(email, code, language?)` signature | ✅ `src/users/service/auth-code.service.ts:94` — returns `Promise<AuthResponseDto>` |
| `SendCodeDto` exists with `email` + optional `locale` | ✅ `src/users/dto/send-code.dto.ts` |
| `VerifyCodeDto` exists with `email`, `code`, optional `language` | ✅ `src/users/dto/verify-code.dto.ts` |
| `GoogleCallbackController` uses `@Controller('auth')` and `@Get('google/callback')` — no route collision with the new `@Post('send-code')` / `@Post('verify-code')` | ✅ `src/users/controller/google-callback.controller.ts:5,11` |
| `AuthModule` controllers/providers/exports layout | ✅ `src/users/auth.module.ts:42,52` — `AuthCodeService` is in `providers` but NOT in `exports`; plan correctly adds it |
| Global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true, transform: true` so `@Body() dto` validates automatically | ✅ `src/main.ts:79-85` |
| `AuthCodeService` throws `HttpException(TOO_MANY_REQUESTS)` + `UnauthorizedException` — Nest's default HTTP exception filter handles these | ✅ `auth-code.service.ts:65-69, 115` |

All file paths in the plan are correct. No missing or stale references.

## Findings

### Critical Issues
None.

### Notes (non-blocking)

1. **`VerifyCodeDto.language` is not in the milestone description but is in the DTO.** The milestone says `POST /auth/verify-code` accepts `{ email, code }`, but the plan reuses `VerifyCodeDto` which also exposes optional `language`. Because the global `ValidationPipe` runs with `whitelist: true`, an unknown field would be stripped, but `language` IS whitelisted — so REST clients can pass it. This is harmless (matches the gRPC surface — `AuthGrpcController.verifyCode` also forwards `request.language`) and arguably better than the milestone's narrower contract, but worth noting that the plan extends the milestone spec by one optional field. Acceptable.

2. **`{ message: 'ok' }` literal vs. gRPC string.** The plan correctly follows the milestone's literal `{ message: 'ok' }` shape, which differs from the gRPC controller's `'If this email is registered, a code has been sent.'` (`auth.grpc.controller.ts:53`). This is intentional per the milestone description.

3. **Adding `AuthCodeService` to `exports` has no immediate consumer.** The new `AuthRestController` lives inside `AuthModule` and doesn't need `AuthCodeService` exported to use it. The milestone explicitly requests the export — plan complies — but the export is dead until something outside the module injects it. Not an issue, just documenting the intent.

4. **No DTO `transform` concerns.** `AuthResponseDto` is a plain class with public fields and a constructor — JSON serialization via `JSON.stringify` (Nest default) emits the expected `{ accessToken, user: { id, email, name, role, language } }` shape. Returning it directly, as the plan instructs, works without `ClassSerializerInterceptor`.

5. **Logging scope.** Plan correctly avoids logging in the controller. `AuthCodeService` already emits warn/log lines for the meaningful outcomes (rate-limit hit, mail-send success, invalid-code attempt), so no observability is lost.

### Positive Notes

- Plan reuses existing DTOs rather than creating REST-specific duplicates — keeps the validation surface in one place.
- `@HttpCode(HttpStatus.OK)` is correctly applied to override Nest's default `201 Created` for `@Post`, matching the "acknowledgement" semantics.
- Explicit instruction not to add `@UseGuards(JwtAuthGuard)` prevents the most common bug pattern when copying from `auth.grpc.controller.ts`.
- Plan correctly identifies that `AuthCodeService` already throws typed Nest HTTP exceptions, so no try/catch translation is needed in the controller.
- Two tasks, clear dependency (Task 2 depends on Task 1), no migrations, no proto changes — scope is minimal and matches the milestone exactly.

PLAN_REVIEW_PASS
