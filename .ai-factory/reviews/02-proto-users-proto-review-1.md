# Review: proto/users.proto

## Files reviewed
- `proto/users.proto` (new)
- `.ai-factory/plans/02-proto-users-proto.md` (new)

## Checklist

| Check | Result |
|-------|--------|
| Proto syntax valid (`protoc` compiles) | Pass |
| Package matches `auth.proto` (`mind`) | Pass |
| Import path `"auth.proto"` resolves (same directory) | Pass |
| `UserDto` reused, not redeclared | Pass |
| Field numbers start at 1, no gaps or conflicts | Pass |
| Both fields optional — matches `UpdateUserDto` | Pass |
| No user ID in request — auth via metadata (matches `LogoutRequest` pattern) | Pass |
| Response type `UserDto` matches REST `UserResponseDto` shape | Pass |
| Service name `UserService` doesn't collide with `AuthService` | Pass |
| Roadmap entry matches implementation | Pass |

## Notes

- No issues found. The contract is minimal and correct — one service, one RPC, one request message, reuses the shared `UserDto` from `auth.proto`.
- The `language` field comment correctly documents that locale validation happens server-side.

REVIEW_PASS
