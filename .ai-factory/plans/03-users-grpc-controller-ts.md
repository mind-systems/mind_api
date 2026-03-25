# Plan: users.grpc.controller.ts

## Context
Add a gRPC controller for the `UserService` proto service, exposing the `UpdateProfile` RPC. The controller follows the same pattern established by `AuthGrpcController` — implements the generated `UserServiceController` interface, delegates to the existing `UserService`, and maps the response to the proto `UserDto`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Extract shared mappers

- [x] **Task 1: Extract `toProtoUserRole` and create `toProtoUserDto` in `src/grpc/grpc-mappers.ts`**
  Files: `src/grpc/grpc-mappers.ts` (new), `src/users/auth.grpc.controller.ts`
  Create `src/grpc/grpc-mappers.ts` with two exported functions:
  - `toProtoUserRole(role: UserRole): number` — move the existing switch from `auth.grpc.controller.ts` (maps `ADMIN` to `1`, `USER`/default to `0`).
  - `toProtoUserDto(dto: UserResponseDto): UserDto` — builds the `{ id, email, name, role: toProtoUserRole(role), language }` object. Import `UserDto` from `../../proto/generated/auth` (not from `users.ts`, which imports but does not re-export it). Import `UserResponseDto` from the auth-response DTO.
  Then update `auth.grpc.controller.ts`:
  - Remove the local `toProtoUserRole` function.
  - Import `toProtoUserRole` and `toProtoUserDto` from `../grpc/grpc-mappers`.
  - Refactor `toProtoAuthResponse` to use `toProtoUserDto(dto.user)` for the `user` field instead of inline mapping.

### Phase 2: Implement controller

- [x] **Task 2: Create `src/users/users.grpc.controller.ts`**
  Files: `src/users/users.grpc.controller.ts` (new)
  Create a new controller class `UsersGrpcController` that implements `UserServiceController` from `proto/generated/users.ts`. Follow the exact pattern from `auth.grpc.controller.ts`:
  - Decorate with `@Controller()`, `@UserServiceControllerMethods()`, `@UseFilters(GrpcExceptionFilter)`.
  - Inject `UserService` via the constructor.
  - Implement `updateProfile(request: UpdateProfileRequest, metadata?: Metadata): Promise<UserDto>`:
    - **Auth (pre-1.4):** Use the same `metadata` approach as `logout` in `auth.grpc.controller.ts` — extract the Bearer token from `metadata?.get('authorization')`, throw `RpcException` with `GrpcStatus.UNAUTHENTICATED` if missing. Decode the JWT payload to get `sub` (import and use `AuthService.validateToken()` or decode inline — follow whichever pattern is used in `logout`). Add the standard `// TODO: uncomment when 1.4 is merged` comments for `@UseInterceptors(GrpcAuthInterceptor)` and `@GrpcCurrentUser()`. Note: once 1.4 ships, the signature changes to `(request, user?: JwtPayload)` with the decorator injecting the user.
    - **Input validation:** Before calling the service, validate request fields manually (gRPC bypasses NestJS `ValidationPipe` / `class-validator`). Import `SUPPORTED_LOCALES` from `../../config/locales`. If `request.name` is provided and has length < 1, throw `RpcException` with `GrpcStatus.INVALID_ARGUMENT` and message `"name must be at least 1 character"`. If `request.language` is provided and is not in `SUPPORTED_LOCALES`, throw `RpcException` with `GrpcStatus.INVALID_ARGUMENT` and message `"language must be one of: en, ru"`. Build a partial update object containing only the fields that were provided (check `!== undefined`).
    - Call `this.userService.updateProfile(userId, updateDto)` with the validated fields.
    - Map the returned `UserResponseDto` to proto `UserDto` using the shared `toProtoUserDto` from `../grpc/grpc-mappers`.
  - Import `UserDto` from `../../proto/generated/auth` (not from `users.ts` — it imports but doesn't re-export it).

- [x] **Task 3: Register the controller in `UserModule`**
  Files: `src/users/user.module.ts`
  Add `UsersGrpcController` to the `controllers` array in `UserModule` alongside the existing `UserController`. Import from `./users.grpc.controller`.
