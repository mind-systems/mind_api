# Review: proto/stats.proto

## Files reviewed
- `proto/stats.proto` (new)
- `.ai-factory/plans/04-proto-stats-proto.md` (new, plan file — not code)

Cross-referenced against:
- `src/stats/dto/user-stats-response.dto.ts` (existing DTO)
- `src/stats/entities/user-stats.entity.ts` (existing entity)
- `proto/auth.proto`, `proto/users.proto` (convention reference)

## Field mapping verification

| Proto field | Proto type | DTO field | Entity column type | Match |
|---|---|---|---|---|
| `total_sessions` | `int32` | `totalSessions: number` | `int` | OK |
| `total_duration_seconds` | `double` | `totalDurationSeconds: number` | `int` | See note |
| `current_streak` | `int32` | `currentStreak: number` | `int` | OK |
| `longest_streak` | `int32` | `longestStreak: number` | `int` | OK |
| `last_session_date` | `optional string` | `lastSessionDate: string \| null` | `date, nullable` | OK |
| `max_completed_complexity` | `double` | `maxCompletedComplexity: number` | `float` | OK |

All 6 DTO fields are present in the proto. No fields missing, no extra fields added. Names correctly converted from camelCase to snake_case.

## Observations

**`total_duration_seconds` typed as `double` while the entity stores `int`** — The DB column is `type: 'int'`, so values are always whole numbers. Using `double` works (all int32 values are exactly representable as IEEE 754 doubles) but is inconsistent with the other integer counters that use `int32`. This is a minor design note, not a bug — `double` is forward-compatible if sub-second precision is ever added.

## Convention compliance

- Header (`syntax`, `package`) matches `auth.proto` / `users.proto` — OK
- Empty request message for auth-via-metadata pattern matches `LogoutRequest` — OK
- `optional string` for nullable field matches `last_used_at` in `TokenDto` — OK
- Section separators and mapping comments follow established style — OK
- Service named `StatsService` with single `GetStats` RPC — OK

## Issues found

None.

REVIEW_PASS
