# Plan: Remove Swagger

## Context
Remove all Swagger/OpenAPI dependencies and decorators from the codebase — the API documentation layer is no longer needed since HTTP controllers were removed in Phase 4.1. This completes roadmap item **4.1 → "Remove Swagger"**.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Bootstrap and configuration

- [x] **Task 1: Remove Swagger setup from main.ts**
  Files: `src/main.ts`
  Remove the `import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'` line. Remove the entire `if (!isProd)` block (lines 77–86) that builds the Swagger document and calls `SwaggerModule.setup()`. Remove the conditional Swagger log line at the bottom (`Logger.log(\`Swagger documentation: ...\``). Leave all other code intact.

### Phase 2: Strip decorators from source files

- [x] **Task 2: Remove Swagger decorators from users/ DTOs**
  Files: `src/users/dto/auth-response.dto.ts`, `src/users/dto/send-code.dto.ts`, `src/users/dto/verify-code.dto.ts`, `src/users/dto/update-user.dto.ts`, `src/users/dto/create-token.dto.ts`, `src/users/dto/token-response.dto.ts`, `src/users/dto/google-auth.dto.ts`
  In each file: delete the `import { ApiProperty ... } from '@nestjs/swagger'` line, then delete every `@ApiProperty(...)` and `@ApiPropertyOptional(...)` decorator line. Keep all other decorators (`@IsEmail`, `@IsString`, `@IsOptional`, etc.) and class structure unchanged.

- [x] **Task 3: Remove Swagger decorators from breath-sessions/ DTOs and entities**
  Files: `src/breath-sessions/dto/breath-session.dto.ts`, `src/breath-sessions/dto/breath-session-settings.dto.ts`, `src/breath-sessions/entities/breath-session.entity.ts`, `src/breath-sessions/entities/breath-session-settings.entity.ts`
  Same approach: delete the `@nestjs/swagger` import line and all `@ApiProperty(...)` / `@ApiPropertyOptional(...)` decorator lines. Preserve TypeORM decorators (`@Column`, `@PrimaryGeneratedColumn`, etc.), class-validator decorators, and class structure.

- [x] **Task 4: Remove Swagger decorators from stats/, sync/, device/ DTOs**
  Files: `src/stats/dto/user-stats-response.dto.ts`, `src/sync/dto/sync-changes.dto.ts`, `src/device/dto/device-ping.dto.ts`
  Same approach: delete the `@nestjs/swagger` import and all `@ApiProperty` / `@ApiPropertyOptional` decorator lines. Keep everything else.

### Phase 3: Uninstall packages and update project docs

- [x] **Task 5: Uninstall Swagger npm packages**
  Files: `package.json`, `package-lock.json`
  Run `npm uninstall @nestjs/swagger swagger-ui-express`. Verify neither package appears in `package.json` afterward.

- [x] **Task 6: Update project context and documentation files to remove Swagger references**
  Files: `.ai-factory/DESCRIPTION.md`, `.ai-factory/ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`

  **`.ai-factory/DESCRIPTION.md`:** Remove the "API Documentation" bullet from Core Features. Remove `@nestjs/swagger` + `swagger-ui-express` from the Tech Stack list (the `Docs:` line).

  **`.ai-factory/ARCHITECTURE.md`:** Rewrite principle #2 — the current text says *"Controllers are thin — they handle HTTP concerns (status codes, response shape, Swagger decorators)"* but HTTP controllers were already deleted; rewrite to reflect gRPC controllers (e.g. *"Controllers are thin — gRPC controllers handle request/response mapping and delegate all business logic to services"*). In principle #6, remove the sentence *"Use `@ApiProperty` on all DTO fields for Swagger completeness"* — keep the principle about DTOs and `class-validator`.

  **`AGENTS.md`:** In the Key Entry Points table, update the `src/main.ts` description from *"App bootstrap — Helmet, Swagger, Winston, port binding"* to remove "Swagger" (e.g. *"App bootstrap — Helmet, Winston, port binding"*). In Key Conventions, delete the *"Swagger: Available at `/api/docs` (disabled in production)"* bullet.

  **`CLAUDE.md`:** In the "Controllers are thin" paragraph (line ~90), remove *"Swagger decorators"* from the parenthetical and update to reflect gRPC controllers. Delete the *"Swagger UI is available at `/api/docs`..."* line (line ~100).

  **`README.md`:** Remove the "Docs" bullet mentioning OpenAPI/Swagger from the features list. Delete the *"Swagger UI: ..."* line with the localhost links. In the "Документация и логи" section, remove the Swagger bullet about DTO decoration and Bearer authorization.

- [x] **Task 7: Mark roadmap item 4.1 "Remove Swagger" as done**
  Files: `.ai-factory/ROADMAP.md`
  Check off the *"Remove Swagger"* task under Phase 4 → 4.1 (change `- [ ]` to `- [x]`).

## Commit Plan
- **Commit 1** (after tasks 1–4): "Remove all Swagger imports, setup, and decorators from source files"
- **Commit 2** (after tasks 5–7): "Uninstall Swagger packages and update project docs"
