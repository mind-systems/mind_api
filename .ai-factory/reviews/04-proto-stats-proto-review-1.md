## Code Review Summary

**Files Reviewed:** 1 (`proto/stats.proto`)
**Risk Level:** 🟢 Low

Cross-referenced against:
- `src/stats/dto/user-stats-response.dto.ts` (source DTO)
- `src/stats/entities/user-stats.entity.ts` (DB entity)
- `src/stats/stats.service.ts` (runtime types)
- `proto/auth.proto`, `proto/users.proto`, `proto/breath_sessions.proto` (convention reference)

### Context Gates

- **ARCHITECTURE.md** — WARN: no proto-specific guidance, but file lives in `proto/` alongside existing contracts; no boundary violations.
- **RULES.md** — OK: rules target TypeScript code (non-null assertions, logging); not applicable to `.proto` files.
- **ROADMAP.md** — OK: `proto/stats.proto` is marked `[x]` in the roadmap. All 6 response fields match the roadmap description.

### Field Mapping

| Proto field | Proto type | DTO field | Entity column | Verdict |
|---|---|---|---|---|
| `total_sessions` | `int32` | `totalSessions: number` | `int` | OK |
| `total_duration_seconds` | `double` | `totalDurationSeconds: number` | `int` | See below |
| `current_streak` | `int32` | `currentStreak: number` | `int` | OK |
| `longest_streak` | `int32` | `longestStreak: number` | `int` | OK |
| `last_session_date` | `optional string` | `lastSessionDate: string \| null` | `date, nullable` | OK |
| `max_completed_complexity` | `double` | `maxCompletedComplexity: number` | `float` | OK |

All 6 DTO fields present. No extra fields, no missing fields. camelCase-to-snake_case naming is correct throughout.

### Suggestions

**`total_duration_seconds` should be `int32`, not `double`** (`proto/stats.proto:17`)

The DB column is `type: 'int'`, and the service computes duration via `Math.floor()` (line 40 of `stats.service.ts`), so the value is always a whole number. Every other integer counter in the same message (`total_sessions`, `current_streak`, `longest_streak`) uses `int32`. The only `double` field — `max_completed_complexity` — maps to a DB `float`, which genuinely holds fractional values.

Using `double` here won't break anything at runtime (integers are exactly representable), but it makes the contract misleading: consumers may expect sub-second precision that the server never provides. If fractional-second tracking is ever added, it would require a DB migration and service changes anyway — the proto type can be updated at that point.

Fix: change line 17 from `double total_duration_seconds = 2;` to `int32 total_duration_seconds = 2;`.

### Positive Notes

- Follows established conventions exactly: header, package, section separators, mapping comments, empty request for auth-via-metadata pattern.
- `optional string` for nullable `last_session_date` matches the `last_used_at` pattern in `auth.proto`.
- YYYY-MM-DD format comment is helpful for consumers who might otherwise assume ISO-8601 datetime.
- Service definition is clean and minimal — single RPC matching the single REST endpoint.
