# Plan: AuthRestController — `POST /auth/send-code` and `POST /auth/verify-code`

## Context
Expose passwordless email-OTP auth endpoints over REST. Today `AuthCodeService.sendCode` / `verifyCode` are only reachable through `AuthGrpcController`; we need parallel REST endpoints in the existing `AuthModule` so HTTP clients can authenticate without gRPC.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: REST controller

- [x] **Task 1: Create `AuthRestController` with `POST /auth/send-code` and `POST /auth/verify-code`**
  Files: `src/users/controller/auth.rest.controller.ts`
  Create a new controller class `AuthRestController` decorated with `@Controller('auth')` (same prefix as `GoogleCallbackController`, both can coexist because their routes don't overlap).
  Inject `AuthCodeService` via the constructor.
  Method `sendCode`:
  - Decorator `@Post('send-code')` and `@HttpCode(HttpStatus.OK)` (return 200, not 201, to match a typical "ok" acknowledgement).
  - Accept body as `@Body() dto: SendCodeDto` (reuse `src/users/dto/send-code.dto.ts` — already has `IsEmail` + optional `locale`).
  - Call `await this.authCodeService.sendCode(dto.email, dto.locale)`.
  - Return `{ message: 'ok' }` (literal shape per milestone description).
  Method `verifyCode`:
  - Decorator `@Post('verify-code')` and `@HttpCode(HttpStatus.OK)`.
  - Accept body as `@Body() dto: VerifyCodeDto` (reuse `src/users/dto/verify-code.dto.ts` — has `email`, `code`, optional `language`).
  - Call `const result = await this.authCodeService.verifyCode(dto.email, dto.code, dto.language)`.
  - Return `result` (the `AuthResponseDto` instance) as-is — NestJS will serialize it directly; do not transform.
  Both endpoints must be public — do NOT apply `@UseGuards(JwtAuthGuard)`.
  Do NOT add request/response logging (per `RULES.md` — no PII in logs, no entry/exit logging). Let exceptions bubble up; `AuthCodeService` already throws `HttpException`/`UnauthorizedException` which Nest's default HTTP exception filter maps to proper status codes.

### Phase 2: Module wiring

- [x] **Task 2: Register `AuthRestController` in `AuthModule` and export `AuthCodeService`** (depends on Task 1)
  Files: `src/users/auth.module.ts`
  - Import `AuthRestController` from `./controller/auth.rest.controller`.
  - Add `AuthRestController` to the `controllers` array alongside `GoogleCallbackController` and `AuthGrpcController`.
  - Verify the current `exports` array — `AuthCodeService` is NOT present today. Add `AuthCodeService` to `exports` per the milestone description ("if not, add it … only the export array needs updating, no logic change"). Keep all existing exports.
  - No changes to `providers`, `imports`, or any other field.

<!-- orchestrator-sessions
planner: 9ce1450c-75e7-465a-89ec-2ac16e2fadd6
elapsed: 331
implementer: 3cfaad8f-1645-4704-9fe5-c69fc9dfd433
-->
