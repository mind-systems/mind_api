# PersonalAccessTokenService — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`PersonalAccessTokenService` manages the full lifecycle of personal access tokens (PATs): creation with SHA-256 hashing, validation with `lastUsedAt` tracking, listing filtered by owner, and revocation with ownership check. It bridges token storage (`PersonalAccessToken` entity) and user identity (`User` entity).

## Instantiation

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    PersonalAccessTokenService,
    { provide: getRepositoryToken(PersonalAccessToken), useValue: mockPatRepo },
    { provide: getRepositoryToken(User), useValue: mockUserRepo },
  ],
}).compile();
const service = module.get<PersonalAccessTokenService>(PersonalAccessTokenService);
```

Mocks:
- `patRepo`: `find()`, `findOne()`, `create()`, `save()`, `update()`, `delete()`
- `userRepo`: `findOne()`
- Real `crypto` — let SHA-256 run for correctness; only mock `randomBytes` for determinism where needed

## Existing Coverage

None.

## Test Cases

### `create(userId, name)`

- should generate a token with `pat_` prefix followed by 64 hex characters
- should hash the raw token with SHA-256 and store only `tokenHash` (never plaintext)
  - Verify: manually hash returned token, compare with value passed to `patRepo.create()`
- should persist entity with `{ userId, tokenHash, name }`
- should return `{ token, id, name, createdAt }` — `tokenHash` must NOT be in response
- should generate different tokens for consecutive calls (randomness check)

### `list(userId)`

- should call `patRepo.find()` with `where: { userId }` and `order: { createdAt: 'DESC' }`
- should select only `['id', 'name', 'createdAt', 'lastUsedAt']` — `tokenHash` excluded
- should return empty array when user has no tokens

### `revoke(id, userId)`

- should call `patRepo.delete()` with `{ id, userId }` — both fields required (ownership check)
- should throw `NotFoundException` when `delete()` returns `{ affected: 0 }`
- should succeed (void) when `delete()` returns `{ affected: 1 }`
- should not be possible to revoke another user's token — cross-user pair returns affected=0 → NotFoundException

### `validateToken(rawToken)`

- should return `null` when token hash not found in DB
- should return `null` when token exists but associated user does not (orphaned token)
  - Assert: no exception thrown
- should hash input with SHA-256 before lookup
  - Assert: `patRepo.findOne()` called with `where: { tokenHash: sha256(rawToken) }`
- should return `JwtPayload { sub: user.id, email, name }` on success
- should update `lastUsedAt` on successful validation
  - Assert: `patRepo.update({ id: pat.id }, { lastUsedAt: expect.any(Date) })`
- should NOT call `patRepo.update()` when token not found (early return)
- should NOT call `patRepo.update()` when user not found (early return)
- should NOT call `userRepo.findOne()` when token not found

## Gotchas

1. **Token never persisted in plaintext** — only `tokenHash` stored. `create()` returns raw token once; test must verify DB receives the hash, not the raw token.
2. **`revoke()` requires both `id` AND `userId`** — security invariant. Querying only by id would allow cross-user revocation. Always verify both fields in the `delete()` where clause.
3. **`validateToken()` returns `null`, never throws** — even for orphaned tokens. Tests must verify graceful null return, not exception.
4. **`lastUsedAt` update only on valid path** — must not be called on token-not-found or user-not-found paths.
5. **`list()` hides `tokenHash`** — even if entity has it in memory, select clause must exclude it.
6. **`randomBytes` mock for determinism** — if mocking, return different values per call or hash collisions will corrupt test state.
7. **`JwtPayload` uses `sub`, not `id`** — verify `sub: user.id`, not `id: user.id`.
8. **`lastUsedAt` timestamp precision** — use `expect.any(Date)` in assertions, not exact timestamp matching.
