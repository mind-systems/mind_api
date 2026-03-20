# AGENTS.md

> Project map for AI agents. Keep this file up-to-date as the project evolves.

## Project Overview
Mind Awake API is a NestJS 11 REST backend for a mindfulness breathing app. It handles passwordless email-code authentication, session-based JWT management, and CRUD operations for breath sessions.

## Tech Stack
- **Language:** TypeScript 5.7
- **Framework:** NestJS 11
- **Database:** PostgreSQL (TypeORM 0.3, migration-based)
- **Auth:** Passwordless email OTP + Google Sign-In + JWT (passport-jwt)
- **Mail:** Resend (transactional email)
- **Infrastructure:** Docker (multi-stage), Makefile, Jenkins CI

## Key Entry Points
| File | Purpose |
|------|---------|
| [src/main.ts](src/main.ts) | App bootstrap — Helmet, Swagger, Winston, port binding |
| [src/app.module.ts](src/app.module.ts) | Root module — imports all feature modules |
| [database.config.ts](database.config.ts) | TypeORM factory config used by AppModule |
| [src/config/typeorm.config.ts](src/config/typeorm.config.ts) | DataSource for TypeORM CLI (migrations) |
| [src/users/auth.controller.ts](src/users/auth.controller.ts) | Auth endpoints |
| [src/breath-sessions/breath-sessions.controller.ts](src/breath-sessions/breath-sessions.controller.ts) | Breath session CRUD |

## AI Context Files
| File | Purpose |
|------|---------|
| AGENTS.md | This file — project structure map |
| [.ai-factory/DESCRIPTION.md](.ai-factory/DESCRIPTION.md) | Project specification and tech stack |
| [.ai-factory/ARCHITECTURE.md](.ai-factory/ARCHITECTURE.md) | Architecture decisions and guidelines |

## Documentation
| Document | Path | Description |
|----------|------|-------------|
| Email Auth | docs/auth/email-auth.md | Passwordless OTP flow |
| Google Auth | docs/auth/google-auth.md | Google Sign-In flow |
| Personal Access Tokens | docs/auth/personal-access-tokens.md | PAT endpoints, security |
| User Profile | docs/auth/user-profile.md | Profile update, language |
| Breath Sessions | docs/breath/breath-sessions.md | Complexity, timeOfDay |
| Suggestions | docs/breath/suggestions.md | Smart suggestions, filtering |
| Socket Overview | docs/socket/overview.md | Architecture, layers |
| Socket Protocol | docs/socket/protocol.md | Events, rate limiting |
| Session Lifecycle | docs/socket/session-lifecycle.md | States, pause, reconnect |
| Telemetry Model | docs/socket/telemetry-model.md | Instruction timeline |
| Socket Database | docs/socket/database.md | DB schemas |
| Socket Config | docs/socket/configuration.md | WS_* env vars |
| User Stats | docs/stats/stats.md | Stats endpoint, streaks |

## Key Conventions
- **Migrations:** Always use explicit migrations (`npm run migration:run`). Never enable `synchronize: true`.
- **Auth flow:** Client calls `POST /auth/send-code` → receives OTP by email → calls `POST /auth/verify-code` → gets JWT
- **Env vars:** Dev uses `.env.dev`, prod uses `.env.prod`; base `.env` for local development
- **Ports:** Dev Docker API=3002, DB=5432; local API=3000
- **Tests:** `src/**/*.spec.ts` pattern; run with `npm test`
- **Swagger:** Available at `/api/docs` (disabled in production)
