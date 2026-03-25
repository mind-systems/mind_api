# Review: proto/device.proto

**Plan:** `05-proto-device-proto.md`
**Files changed:** `proto/device.proto` (new)

## Field mapping verification

All 11 `DevicePingDto` fields mapped correctly:

| Proto field | DTO field | Type | Optional | Match |
|---|---|---|---|---|
| `string installation_id = 1` | `installationId: string` | string→string | no | ✅ |
| `string platform = 2` | `platform: string` | string→string | no | ✅ |
| `string os_version = 3` | `osVersion: string` | string→string | no | ✅ |
| `string locale = 4` | `locale: string` | string→string | no | ✅ |
| `string timezone = 5` | `timezone: string` | string→string | no | ✅ |
| `int32 screen_width = 6` | `screenWidth: number` (`@IsInt @Min(0)`) | int32→number | no | ✅ |
| `int32 screen_height = 7` | `screenHeight: number` (`@IsInt @Min(0)`) | int32→number | no | ✅ |
| `string app_version = 8` | `appVersion: string` | string→string | no | ✅ |
| `string build_number = 9` | `buildNumber: string` | string→string | no | ✅ |
| `optional string model = 10` | `model?: string` (`@IsOptional`) | string→string | yes | ✅ |
| `optional string manufacturer = 11` | `manufacturer?: string` (`@IsOptional`) | string→string | yes | ✅ |

No DTO fields are missing. No extra fields were added.

## Convention compliance

- `syntax = "proto3";` and `package mind;` — matches all existing protos. ✅
- Section separator comments (`// ---...`) — matches `auth.proto`, `stats.proto`, etc. ✅
- DTO mapping comment on `PingRequest` — matches established pattern. ✅
- Custom `PingResponse {}` instead of `google.protobuf.Empty` — matches codebase convention (no well-known type imports in any existing proto). ✅
- No auth metadata note needed — REST endpoint (`DeviceController.ping`) has no auth guard, consistent with proto having no auth comment. ✅

## Semantic correctness

- REST `POST /device/ping` returns `204 No Content` (`Promise<void>`). Proto `PingResponse {}` is the semantic equivalent — empty response body. ✅
- Entity server-managed fields (`id`, `lastSeenAt`, `createdAt`) are correctly excluded from the request message. ✅
- Field number ordering is sequential (1–11) with no gaps. ✅

## No issues found

The proto file is a clean, correct mapping of the existing REST contract. No bugs, no security concerns, no convention violations.

REVIEW_PASS
