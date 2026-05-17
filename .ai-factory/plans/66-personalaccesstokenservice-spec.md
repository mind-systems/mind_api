# Test Plan: PersonalAccessTokenService spec

## Context
`PersonalAccessTokenService` (`src/users/service/personal-access-token.service.ts`) manages the lifecycle of personal access tokens (create / list / revoke / validate). No spec exists yet. These tests must guarantee that the raw token is never persisted, that ownership is enforced on revocation, that orphaned tokens are handled gracefully on validation, and that `lastUsedAt` is updated only on the successful path.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/users/service/personal-access-token.service.spec.ts`

## Target Spec File
`src/users/service/personal-access-token.service.spec.ts`

## Tasks

### Phase 1: PersonalAccessTokenService — `create(userId, name)`

- [x] **Task 1: `create()` — token generation and shape**
  Files: `src/users/service/personal-access-token.service.spec.ts`
  Test cases:
  - `should return a token matching /^pat_[0-9a-f]{64}$/ when create is called`
  - `should return response with shape { token, id, name, createdAt } when create succeeds`
  - `should NOT include tokenHash in the response when create succeeds`
  - `should return different tokens when create is called twice consecutively` (let real `crypto.randomBytes` run; assert the two `token` strings are not equal)

- [x] **Task 2: `create()` — persistence stores only the hash**
  Files: `src/users/service/personal-access-token.service.spec.ts`
  Test cases:
  - `should call patRepo.create() with { userId, tokenHash, name } when create is called` (compute `sha256(returnedToken)` and assert it equals the `tokenHash` argument)
  - `should pass the SHA-256 hash and NOT the raw token to patRepo.create() when create is called` (assert `tokenHash !== returnedToken` in the captured `create()` argument)
  - `should call patRepo.save() with the entity returned by patRepo.create() when create succeeds`
  - `should use the saved entity's id and createdAt in the response when create succeeds` (mock `patRepo.save` to resolve with a known id/createdAt and assert they appear in the result)

### Phase 2: PersonalAccessTokenService — `list(userId)`

- [x] **Task 3: `list()` — query options**
  Files: `src/users/service/personal-access-token.service.spec.ts`
  Test cases:
  - `should call patRepo.find() with { where: { userId }, order: { createdAt: 'DESC' }, select: ['id', 'name', 'createdAt', 'lastUsedAt'] } when list is called`
  - `should return the array produced by patRepo.find() when list is called`
  - `should return an empty array when patRepo.find() resolves to []`

### Phase 3: PersonalAccessTokenService — `revoke(id, userId)`

- [x] **Task 4: `revoke()` — ownership check and not-found handling**
  Files: `src/users/service/personal-access-token.service.spec.ts`
  Test cases:
  - `should call patRepo.delete() with { id, userId } when revoke is called` (both fields are required — ownership invariant)
  - `should resolve without error when patRepo.delete() returns { affected: 1 }`
  - `should throw NotFoundException when patRepo.delete() returns { affected: 0 }`
  - `should throw NotFoundException when patRepo.delete() returns { affected: undefined }` (covers the `!result.affected` branch for falsy values)

### Phase 4: PersonalAccessTokenService — `validateToken(rawToken)`

- [x] **Task 5: `validateToken()` — lookup by hash**
  Files: `src/users/service/personal-access-token.service.spec.ts`
  Test cases:
  - `should call patRepo.findOne() with { where: { tokenHash: sha256(rawToken) } } when validateToken is called` (compute the expected hash with real `crypto` in the test)
  - `should NOT pass the raw token to patRepo.findOne() when validateToken is called`

- [x] **Task 6: `validateToken()` — null-return paths**
  Files: `src/users/service/personal-access-token.service.spec.ts`
  Test cases:
  - `should return null when patRepo.findOne() resolves to null` (token not found)
  - `should return null when userRepo.findOne() resolves to null` (orphaned token — no exception)
  - `should NOT throw when the associated user is missing` (explicit no-throw assertion for the orphan path)
  - `should NOT call userRepo.findOne() when patRepo.findOne() returns null`
  - `should NOT call patRepo.update() when patRepo.findOne() returns null`
  - `should NOT call patRepo.update() when userRepo.findOne() returns null`

- [x] **Task 7: `validateToken()` — success path**
  Files: `src/users/service/personal-access-token.service.spec.ts`
  Test cases:
  - `should return { sub: user.id, email: user.email, name: user.name } when token and user are found`
  - `should call userRepo.findOne() with { where: { id: pat.userId } } when token is found`
  - `should call patRepo.update() with ({ id: pat.id }, { lastUsedAt: expect.any(Date) }) when validation succeeds`
  - `should return a payload with sub (not id) on the JwtPayload when validation succeeds`
