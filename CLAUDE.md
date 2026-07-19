# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev          # Watch mode (local)
npm run build              # Compile TypeScript
npm run start:prod         # Run compiled output

# Testing
npm test                   # Run all unit tests
npm run test:cov           # With coverage
npm run test:e2e           # End-to-end tests
# Run a single test file:
npx jest src/users/service/auth.service.spec.ts

# Linting & formatting
npm run lint               # ESLint --fix
npm run format             # Prettier

# Migrations
npm run migration:run      # Apply pending migrations
npm run migration:revert   # Revert last migration
npm run migration:create src/migrations/<Name>  # Scaffold new migration

# Docker (staging)
make up                    # Start (API on :3002, DB on :5432)
make down                  # Stop
make logs                  # Tail nestjs logs
make health                # curl localhost:3002/health

# Docker (prod)
make build-prod && make up-prod
```

## Logging

Write all logs through NestJS's **`Logger`** from `@nestjs/common` — instantiate per class as `new Logger(ClassName.name)`. Never log via `console.*` or any other logger.

## Architecture

**Pattern:** Modular Monolith. Each domain under `src/` is a self-contained NestJS feature module. Modules communicate only through their exported providers — never by importing internals from another module's files. The module set is read from `src/` and `app.module.ts` — it is not duplicated here; boundary rules and the module template live in `.ai-factory/ARCHITECTURE.md`.

`ConfigModule` (`isGlobal: true`) and `MailModule` (`@Global()`) are available everywhere without explicit import.

### Auth system

Authentication is passwordless — email + one-time code.

All protected routes use **`JwtAuthGuard`** (passport-jwt), which validates the token against the **`user_sessions`** table. On logout the session is deleted; expired sessions are purged nightly via `@Cron`.

### Entities belong to their module

`@InjectRepository` is only used within the module that owns the entity. If `BreathSessionsModule` needs user data, it calls `AuthService` (exported by `AuthModule`) — it does not inject `UserRepository` directly.

### Database migrations

`synchronize` is always `false`. All schema changes require an explicit migration file under `src/migrations/`. Migrations run automatically on startup (`migrationsRun: true` in `database.config.ts`) but should also be run manually during development with `npm run migration:run`.

**Never hand-craft migration timestamps.** Always generate via CLI:

```bash
npx typeorm migration:create src/migrations/<ActionName>
```

Naming convention — action-based: `AddAuthCodesTable`, `AddUserRoleColumn`, `CreateTradesTable`, `AddIndexToOrders`.

There are two TypeORM config files:
- `database.config.ts` — factory used by `AppModule` at runtime
- `src/config/typeorm.config.ts` — `DataSource` instance used by the TypeORM CLI for migration commands

### Controllers are thin

gRPC controllers handle request/response mapping and delegate all business logic to services.

### Environment

| File | Used for |
|------|----------|
| `.env` | Local development (base) |
| `.env.staging` | Docker staging (`make up`) |
| `.env.prod` | Docker prod (`make up-prod`) |

### Documentation

| Document | Path | Description |
|----------|------|-------------|
| Proto & gRPC toolchain | `proto/README.md` | Single source of truth for `.proto` files, `proto:gen` codegen, generated stub location, consumer propagation workflow |
| Email Auth | `docs/auth/email-auth.md` | Passwordless OTP flow — endpoints, DB, mail, token lifecycle |
| Auth Rate Limiting | `docs/auth/rate-limiting.md` | Send cooldown, verify lockout, REST throttle, IP keying |
| Google Auth | `docs/auth/google-auth.md` | Google Sign-In via server auth code flow |
| Personal Access Tokens | `docs/auth/personal-access-tokens.md` | PAT endpoints, security, token format |
| User Profile | `docs/auth/user-profile.md` | Profile update, language preference |
| Breath Sessions | `docs/breath/breath-sessions.md` | Complexity calculation, timeOfDay field |
| Suggestions | `docs/breath/suggestions.md` | Smart suggestions endpoint, filtering algorithm |
| Realtime Overview | `docs/realtime/overview.md` | Layered architecture, modules, in-memory state |
| Realtime Protocol | `docs/realtime/protocol.md` | ModuleStateService, ModuleInstructionService, commands and responses |
| Session Lifecycle | `docs/realtime/session-lifecycle.md` | States, reconnect, grace period, server restart recovery |
| Instruction Model | `docs/realtime/instruction-model.md` | Instruction stream concept, activity:start trigger, biometric correlation |
| Biometric Stream | `docs/realtime/biometric-stream.md` | BioSample envelope, pause semantics, batch consistency, time-join with instructions |
| Realtime Database | `docs/realtime/database.md` | module_sessions, session_stream_samples, bio_session_samples, user_stats schemas |
| Realtime Config | `docs/realtime/configuration.md` | WS_* and WS_BIO_* environment variables |
| User Stats | `docs/stats/stats.md` | GET /users/me/stats endpoint, streak rules, min-duration filter |
| Sync | `docs/sync/sync.md` | Change events journal, GET /sync/changes, WebSocket sync:changed push, TTL |
| Log Destinations | `docs/observability/log-destinations.md` | LOG_DESTINATION modes (file/grafana/both), OTLP_ENDPOINT, real-env requirement |
