# Plan: Personal Access Tokens

## Context
Add long-lived personal access tokens (PATs) for CLI/MCP access. Users can create, list, and revoke tokens via three new endpoints under `/auth/tokens`. PATs are stored as SHA-256 hashes and accepted by `JwtAuthGuard` alongside regular JWTs, distinguished by a `pat_` prefix.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Database

- [x] **Task 1: Create PersonalAccessToken entity**
  Files: `src/users/entities/personal-access-token.entity.ts`
  Create entity for `personal_access_tokens` table following the `UserSession` entity pattern:
  - `id`: `@PrimaryGeneratedColumn('uuid')`
  - `userId`: `@Column('uuid')` with `@Index()`
  - `tokenHash`: `@Column({ unique: true })` with `@Index()` — stores SHA-256 hex of the raw token
  - `name`: `@Column('character varying')` — user-provided label (e.g. "My CLI token")
  - `lastUsedAt`: `@Column({ type: 'timestamp', nullable: true, default: null })` — updated on each use, same pattern as `UserSession.lastSeenAt`
  - `createdAt`: `@CreateDateColumn()`

- [x] **Task 2: Create migration for personal_access_tokens table** (depends on Task 1)
  Files: `src/migrations/<timestamp>-CreatePersonalAccessTokensTable.ts`
  Generate via CLI: `npx typeorm migration:create src/migrations/CreatePersonalAccessTokensTable`. Write `up()` with raw SQL:
  - Table `personal_access_tokens` with columns matching the entity (uuid PK with `uuid_generate_v4()` default, `userId` uuid, `tokenHash` character varying unique, `name` character varying, `lastUsedAt` timestamp nullable, `createdAt` timestamp default now)
  - Index `IDX_personal_access_tokens_userId` on `userId`
  - Unique index `IDX_personal_access_tokens_tokenHash` on `tokenHash`
  - `down()` drops the table

### Phase 2: Service layer

- [x] **Task 3: Create PersonalAccessTokenService** (depends on Task 1)
  Files: `src/users/service/personal-access-token.service.ts`
  New service following the `SessionService` pattern:
  - Inject `@InjectRepository(PersonalAccessToken)` and `@InjectRepository(User)`
  - Private `hash(token: string): string` method using `createHash('sha256')` (same as `SessionService.hash`)
  - `create(userId: string, name: string): Promise<{ token: string; id: string; name: string; createdAt: Date }>` — generate 32-byte random hex via `crypto.randomBytes(32).toString('hex')`, prepend `pat_` prefix, hash it with SHA-256, save entity with `userId`, `tokenHash`, `name`, return the raw `pat_`-prefixed token (shown to user only once), `id`, `name`, `createdAt`
  - `list(userId: string): Promise<PersonalAccessToken[]>` — find all tokens for the user, ordered by `createdAt` DESC. Returns entities (never includes raw token)
  - `revoke(id: string, userId: string): Promise<void>` — delete token by `id` AND `userId` (ownership check). Throw `NotFoundException` if not found/not owned
  - `validateToken(rawToken: string): Promise<JwtPayload | null>` — hash the raw token, look up by `tokenHash`, if found update `lastUsedAt` and return a `JwtPayload` object `{ sub: userId, email: user.email, name: user.name }` by loading the user. Return `null` if token not found or user not found

### Phase 3: Guard modification

- [x] **Task 4: Update JwtAuthGuard to accept PATs** (depends on Task 3)
  Files: `src/users/guards/jwt-auth.guard.ts`
  Modify `canActivate` to detect PATs by prefix before attempting JWT verification:
  1. Extract token from `Authorization: Bearer <token>` (existing logic)
  2. If `token.startsWith('pat_')`: call `personalAccessTokenService.validateToken(token)`. If it returns a `JwtPayload`, assign to `request.user` and return `true`. If `null`, throw `UnauthorizedException('Invalid personal access token')`.
  3. Otherwise: proceed with existing JWT flow (no changes)
  Inject `PersonalAccessTokenService` into the guard constructor.

- [x] **Task 5: Update OptionalJwtAuthGuard to accept PATs** (depends on Task 3)
  Files: `src/users/guards/optional-jwt-auth.guard.ts`
  Apply the same `pat_` prefix detection logic:
  1. If token starts with `pat_`: call `personalAccessTokenService.validateToken(token)`. If it returns payload, assign to `request.user`.
  2. Otherwise: proceed with existing JWT flow.
  3. All errors are silently caught (existing behavior for optional guard).
  Inject `PersonalAccessTokenService` into the guard constructor.

### Phase 4: Controller and DTOs

- [x] **Task 6: Create DTOs for token endpoints** (depends on Task 3)
  Files: `src/users/dto/create-token.dto.ts`, `src/users/dto/token-response.dto.ts`
  `CreateTokenDto`:
  - `name`: `@IsString()`, `@IsNotEmpty()`, `@ApiProperty({ example: 'My CLI token' })`

  `TokenResponseDto` (for list endpoint):
  - `id`, `name`, `createdAt`, `lastUsedAt` — all with `@ApiProperty()`

  `CreateTokenResponseDto` (for create endpoint — includes raw token):
  - `token`: `@ApiProperty({ description: 'Raw token — shown only once' })`
  - `id`, `name`, `createdAt` — with `@ApiProperty()`

- [x] **Task 7: Add token endpoints to AuthController** (depends on Task 6)
  Files: `src/users/auth.controller.ts`
  Add three endpoints to the existing `AuthController`, all protected by `@UseGuards(JwtAuthGuard)` and `@ApiBearerAuth()`:
  - `POST /auth/tokens` — `@HttpCode(201)`, accepts `CreateTokenDto` body, calls `personalAccessTokenService.create(user.sub, dto.name)`, returns `CreateTokenResponseDto`
  - `GET /auth/tokens` — `@HttpCode(200)`, calls `personalAccessTokenService.list(user.sub)`, returns `TokenResponseDto[]`
  - `DELETE /auth/tokens/:id` — `@HttpCode(200)`, calls `personalAccessTokenService.revoke(id, user.sub)`, returns `{ message: 'Token revoked.' }`
  Use `@CurrentUser()` decorator to extract user. Add `@ApiOperation` and `@ApiResponse` decorators matching existing controller patterns.

### Phase 5: Module wiring

- [x] **Task 8: Register entity and service in AuthModule** (depends on Tasks 3, 7)
  Files: `src/users/auth.module.ts`
  - Add `PersonalAccessToken` to `TypeOrmModule.forFeature([..., PersonalAccessToken])`
  - Add `PersonalAccessTokenService` to `providers` array
  - Add `PersonalAccessTokenService` to `exports` array (needed by guards in other modules that import `AuthModule`)
  - Inject `PersonalAccessTokenService` into `AuthController` constructor

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add personal_access_tokens entity and migration"
- **Commit 2** (after tasks 3-5): "Add PAT service and update guards to accept PAT tokens"
- **Commit 3** (after tasks 6-8): "Add PAT endpoints and wire up AuthModule"
