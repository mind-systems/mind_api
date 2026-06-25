# Architecture: Modular Monolith

## Overview
Mind Awake API is structured as a **Modular Monolith** — a single deployable NestJS application with strong, explicit boundaries between feature modules. Each module owns its controllers, services, entities, DTOs, and guards. Modules communicate only through their public API (exported providers), never by reaching into each other's internals.

This pattern fits the project well: small team, clear domain boundaries (auth, mail, breath sessions), single PostgreSQL database, and Docker-based single-container deployment. NestJS's module system enforces these boundaries naturally via the `@Module` decorator's `imports`/`exports` declarations.

## Decision Rationale
- **Project type:** REST API backend for a mobile mindfulness app
- **Tech stack:** TypeScript, NestJS 11, PostgreSQL + TypeORM
- **Team size:** Small (1-5 developers)
- **Domain complexity:** Low-Medium (auth + CRUD, no complex business rules)
- **Key factor:** NestJS modules already provide ideal modular monolith boundaries with minimal overhead; the project doesn't justify microservice complexity or strict clean architecture ceremony

## Folder Structure

```
src/
├── main.ts                  # Bootstrap
├── app.module.ts            # Root module
├── health.controller.ts     # Standalone controller (no module)
│
├── [feature]/               # One directory per feature module
│   ├── [feature].module.ts
│   ├── [feature].controller.ts
│   ├── [feature].service.ts
│   ├── dto/
│   ├── entities/
│   └── guards/, strategies/, decorators/, interfaces/  (по необходимости)
│
├── config/                  # Infrastructure config (TypeORM DataSource, etc.)
└── migrations/              # TypeORM migrations (explicit only, no synchronize)
```

Global/cross-cutting modules (e.g. `mail/`) live alongside feature modules but are marked `@Global()` and do not need to be explicitly imported.

## Dependency Rules

Modules communicate only through exported providers. Never import internal files from another module.

```
AppModule
  ├── MailModule (global)       →  ConfigModule
  ├── AuthModule                →  MailModule (implicit, global), ScheduleModule
  └── BreathSessionsModule      →  AuthModule (for JwtAuthGuard + @CurrentUser)
```

- ✅ `BreathSessionsModule` imports `AuthModule` to use `JwtAuthGuard` and `@CurrentUser()`
- ✅ All modules import `ConfigModule` (it's global via `isGlobal: true`)
- ✅ `MailModule` is `@Global()` — no explicit import needed in feature modules
- ❌ Never import a service directly from another module's `service/` folder — only use what's exported via `@Module({ exports: [...] })`
- ❌ Never reach into another module's `entities/` — use the owning module's service or TypeORM `@InjectRepository` within the same module
- ❌ Never import `AuthModule` internals (e.g., `JwtStrategy`) directly — only consume exported guards/decorators

## Layer / Module Communication

Within a module, the standard NestJS layers apply:

```
HTTP Request
     ↓
Controller          (validates input via DTOs + pipes, delegates to service)
     ↓
Service             (business logic, orchestration, calls repository)
     ↓
TypeORM Repository  (database access via @InjectRepository)
     ↓
PostgreSQL
```

Between modules — only through the module's public exports:

```typescript
// users/auth.module.ts — defines the public API
@Module({
  exports: [JwtAuthGuard, AuthService, CurrentUserDecorator],  // public API
  providers: [AuthService, SessionService, JwtStrategy],  // internal
})
export class AuthModule {}

// breath-sessions/breath-sessions.module.ts — consumes the public API
@Module({
  imports: [AuthModule],  // gets access to exports only
})
export class BreathSessionsModule {}
```

## Key Principles

1. **Module = domain boundary.** One module per feature domain. The module file is the single source of truth for what a module exposes vs. keeps internal.

2. **Services own business logic.** Controllers are thin — gRPC controllers handle request/response mapping and delegate all business logic to services.

3. **Entities stay in their module.** Each entity belongs to the module that owns it. Other modules access that data through the owning module's service, not directly via `@InjectRepository`.

4. **Explicit migrations only.** Never set `synchronize: true`. All schema changes go through TypeORM migration files in `src/migrations/`. Run with `npm run migration:run`.

5. **Guards are the access control boundary.** `JwtAuthGuard` protects all authenticated routes. Auth endpoints (`send-code`, `verify-code`) carry no `JwtAuthGuard` — they are public — but they are rate-limited by a controller-scoped throttle guard. Apply guards at the controller or route level — never inside services.

6. **DTOs are the API contract.** Every controller method accepts a typed DTO. Use `class-validator` decorators on all DTOs.

7. **Client IP comes from the TCP peer, never from `X-Forwarded-For`.** Production exposes the API HTTP port directly — there is no reverse proxy in front of it, and nothing in the stack sets or strips `X-Forwarded-For`. Express `trust proxy` is therefore deliberately left **off**, so `req.ip` resolves to the real connecting peer and any client-supplied `X-Forwarded-For` is ignored. All IP-derived logic (rate limiting, throttling, audit) must key on `req.ip`. Do **not** enable `trust proxy` on its own — with no XFF-stripping proxy in front, trusting the header would let a caller forge a fresh identity per request and defeat IP-based controls. It may be enabled **only** together with a real reverse proxy that overwrites client-supplied `X-Forwarded-For`, and only with the hop count set to match that proxy. (Operational caveat: Docker's default `userland-proxy` can present the bridge gateway as the source IP in some setups — durable per-identity controls must not rely on per-IP keying alone.)

## Code Examples

### New Feature Module

```typescript
// src/meditations/meditations.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { MeditationsController } from './meditations.controller';
import { MeditationsService } from './meditations.service';
import { Meditation } from './entities/meditation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Meditation]),
    AuthModule,  // for JwtAuthGuard + @CurrentUser()
  ],
  controllers: [MeditationsController],
  providers: [MeditationsService],
  // exports: [MeditationsService]  // only if other modules need it
})
export class MeditationsModule {}
```

### Thin Controller, Logic in Service

```typescript
// Controller: HTTP concerns only
@Controller('meditations')
@UseGuards(JwtAuthGuard)
export class MeditationsController {
  constructor(private readonly meditationsService: MeditationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateMeditationDto,
    @CurrentUser() user: User,
  ) {
    return this.meditationsService.create(dto, user.id);
  }
}

// Service: business logic + data access
@Injectable()
export class MeditationsService {
  constructor(
    @InjectRepository(Meditation)
    private readonly meditationsRepo: Repository<Meditation>,
  ) {}

  async create(dto: CreateMeditationDto, userId: string): Promise<Meditation> {
    const meditation = this.meditationsRepo.create({ ...dto, userId });
    return this.meditationsRepo.save(meditation);
  }
}
```

### Exposing Module Public API

```typescript
// Only export what other modules need
@Module({
  providers: [AuthService, SessionService, JwtStrategy],
  exports: [
    JwtAuthGuard,       // guards used by feature modules
    // NOT exporting: SessionService, JwtStrategy (internal)
  ],
})
export class AuthModule {}
```

### TypeORM Migration (not synchronize)

```bash
# Generate a new migration
npm run migration:create src/migrations/AddDurationToBreathSessions

# Run pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```

## Anti-Patterns

- ❌ **God service** — a service that handles logic for multiple unrelated domains. Split into separate module services.
- ❌ **Cross-module repository access** — importing `@InjectRepository(User)` inside `BreathSessionsModule`. Use `AuthService` instead.
- ❌ **Logic in controllers** — database queries, business rules, or conditional logic in controller methods. Move to service layer.
- ❌ **`synchronize: true` in any environment** — always use explicit migrations.
- ❌ **Skipping guards** — accessing `request.user` without a guard. Always apply `@UseGuards(JwtAuthGuard)` at the controller or route level.
- ❌ **Circular module imports** — if Module A imports Module B and Module B imports Module A, extract the shared logic to a `SharedModule` or a new standalone module.
- ❌ **Hardcoded secrets** — never hardcode JWT secrets, Resend API keys, or DB passwords. Always use `ConfigService` / environment variables.

---

## Features

| Feature | Hashes |
|---------|--------|
| **Auth** | |
| Email OTP auth | f0d36b7 |
| Google Sign-In | 9b78a07 |
| User profile | |
| Personal access tokens | cfd8706 |
| Device ping | |
| **Breath sessions** | |
| Breath session CRUD | 2e497e7 f684c24 |
| Time-of-day suggestions | |
| Session statistics (streak, duration, complexity) | |
| **Sync** | |
| Sync change journal (TTL, purge) | |
| Sync unary (cursor, full-resync sentinel) | |
| Sync change stream | 733e428 19935b7 |
| **Realtime** | |
| gRPC transport | f39c8bd |
| Activity session stream | 128bb67 c57784f 81b6a49 1698261 |
| Instruction stream | 449f3f9 f057704 731ab41 |
| Session revocation disconnect | da84ee0 |
| **Biometric** | |
| Biometric stream | bc32504 f057704 731ab41 |
| **BCI** | |
| BCI device management | fd65dc3 |
| **NFB calibration** | |
| NFB calibration history | 5b1de88 b6b2040 9a294ab |
| **Meditation** | |
| Meditation notes | 61f8b41 d7bdd4a |
| Meditation poses | d7bdd4a |
| **Web dashboard** | |
| Web dashboard REST API | 456e566 9d537d1 854a034 1da5c00 791927d |
| **Internal** | |
| Roadmap drop history | a5959dc, 0656ef1 |
