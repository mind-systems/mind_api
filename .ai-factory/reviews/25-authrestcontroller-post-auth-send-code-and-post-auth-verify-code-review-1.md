# Code Review: AuthRestController — `POST /auth/send-code` and `POST /auth/verify-code`

**Plan:** `.ai-factory/plans/25-authrestcontroller-post-auth-send-code-and-post-auth-verify-code.md`
**Files changed:**
- `src/users/controller/auth.rest.controller.ts` (new)
- `src/users/auth.module.ts` (modified)

## Verification

### `src/users/controller/auth.rest.controller.ts`
- `@Controller('auth')` — coexists with `GoogleCallbackController` (which uses `@Get('google/callback')`) and the gRPC controller (no HTTP routes). No route collision.
- `@Post('send-code')` + `@HttpCode(HttpStatus.OK)` — correctly overrides Nest's default 201 for POST.
- `@Body() dto: SendCodeDto` — `SendCodeDto` validates `email` (IsEmail, IsNotEmpty) and optional `locale` (IsString). Combined with the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` in `src/main.ts`, malformed bodies → 400.
- `sendCode` delegates to `AuthCodeService.sendCode(email, rawLocale?)` — signature matches (`auth-code.service.ts:35`).
- Returns `{ message: 'ok' }` — literal shape per milestone.
- `@Post('verify-code')` + `@HttpCode(HttpStatus.OK)` — same correctness.
- `@Body() dto: VerifyCodeDto` — validates `email`, `code` (6-digit regex), optional `language`.
- `verifyCode` delegates to `AuthCodeService.verifyCode(email, code, language?)` — signature matches (`auth-code.service.ts:94`). Returns `AuthResponseDto` directly; Nest's default JSON serializer emits `{ accessToken, user: { id, email, name, role, language } }` correctly because `AuthResponseDto` / `UserResponseDto` are plain classes with public fields.
- No `@UseGuards(JwtAuthGuard)` — public, as required.
- No logging — complies with `RULES.md` (no PII, no entry/exit).
- `AuthCodeService` throws `HttpException(TOO_MANY_REQUESTS)` and `UnauthorizedException`, which Nest's default HTTP filter maps to 429 / 401. Bubbling without translation is correct.

### `src/users/auth.module.ts`
- `AuthRestController` imported and added to `controllers` array — registers the REST routes.
- `AuthCodeService` added to `exports` (was only in `providers` before) — matches milestone instruction.
- No other changes; `providers`, `imports`, JWT factory all untouched.

## Findings

None. The implementation matches the plan and milestone exactly, signatures line up with the service, validation is wired through the global pipe, and exceptions surface through Nest's default filter at the correct HTTP status codes.

REVIEW_PASS
