# Plan: proto/users.proto

## Context
Define the gRPC service contract for user profile operations in a new `users.proto` file. This is a contract-only milestone: no code generation, no gRPC transport wiring, no controller changes. The `UpdateProfile` RPC maps 1:1 to the existing `PATCH /user` REST endpoint.

## Settings
- Testing: no
- Logging: no
- Docs: no

## Tasks

### Phase 1: Proto file

- [x] **Task 1: Create proto/users.proto with UpdateProfile RPC**
  Files: `proto/users.proto`
  Create `users.proto` in the existing `proto/` directory.
  Header: `syntax = "proto3"; package mind;` — same package as `auth.proto`.

  Import the shared `UserDto` from `auth.proto`:
  ```protobuf
  import "auth.proto";
  ```
  `UserDto` and `UserRole` are already defined in `auth.proto` — do not redeclare them.

  Add the request message mapped to the existing `UpdateUserDto` (`src/users/dto/update-user.dto.ts`):
  - `message UpdateProfileRequest` — `optional string name = 1; optional string language = 2;`
  Both fields are optional, matching the DTO. Add a comment noting that `language` must be a supported locale (`en`, `ru`) — validated server-side, not expressible in proto3 syntax.

  Auth identity comes from metadata/interceptor (same pattern as `LogoutRequest` in `auth.proto`), so the request message carries no user ID.

  Add the service definition:
  ```protobuf
  service UserService {
    rpc UpdateProfile(UpdateProfileRequest) returns (UserDto);
  }
  ```

  The response is `UserDto` directly (not wrapped), matching how the REST endpoint returns `UserResponseDto`.

  Cross-check every field against the existing DTOs:
  - `UpdateUserDto` → `name` (optional string, min 1), `language` (optional, in SUPPORTED_LOCALES) ✓
  - Response `UserResponseDto` → `id`, `email`, `name`, `role`, `language` → already covered by `UserDto` in `auth.proto` ✓
