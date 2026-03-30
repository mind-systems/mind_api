## Code Review: Fix UUID column types and add FK constraints

**Plan:** `.ai-factory/plans/48-fix-uuid-column-types-and-add-fk-constraints.md`
**Files changed:** 4 (3 entities + 1 migration)

### Entity changes

All three entity files are correct:

- **module-session.entity.ts** — `userId` and `activityRefId` decorators now specify `type: 'uuid'`. Stale comment replaced with accurate one referencing the migration FK. No other fields or decorators touched.
- **session-stream-sample.entity.ts** — `moduleSessionId` decorator now specifies `type: 'uuid'`. Clean, minimal change.
- **user-stats.entity.ts** — `userId` decorator now specifies `type: 'uuid'`. Stale comment replaced. `@Index({ unique: true })` preserved.

### Migration changes

**`up()` method** — verified all four CREATE TABLE blocks:

| Table | Column type fix | FK added | Comma placement |
|---|---|---|---|
| `user_stats` | `varchar` → `uuid` ✅ | `FK_user_stats_userId` → `users(id)` CASCADE ✅ | After UQ constraint ✅ |
| `personal_access_tokens` | already `uuid` — no change ✅ | `FK_personal_access_tokens_userId` → `users(id)` CASCADE ✅ | After UQ constraint ✅ |
| `module_sessions` | `userId` varchar → uuid, `activityRefId` varchar → uuid ✅ | `FK_module_sessions_userId` → `users(id)` CASCADE ✅ | After PK constraint ✅ |
| `session_stream_samples` | `varchar` → `uuid` ✅ | `FK_session_stream_samples_moduleSessionId` → `module_sessions(id)` CASCADE ✅ | After PK constraint ✅ |

No trailing commas after the last constraint in any block. SQL syntax is valid.

**`down()` method** — no changes made. Verified drop order is still correct with the new FKs:
1. `session_stream_samples` (FK → `module_sessions`) dropped before `module_sessions` ✅
2. `module_sessions` (FK → `users`) dropped before `users` ✅
3. `personal_access_tokens` (FK → `users`) dropped before `users` ✅
4. `user_stats` (FK → `users`) dropped before `users` ✅
5. All other tables with existing FKs to `users` also dropped before `users` ✅

### Entity–migration alignment

| Entity column | Decorator type | Migration column type | Match |
|---|---|---|---|
| `ModuleSession.userId` | `{ type: 'uuid' }` | `uuid NOT NULL` | ✅ |
| `ModuleSession.activityRefId` | `{ type: 'uuid', nullable: true }` | `uuid DEFAULT NULL` | ✅ |
| `SessionStreamSample.moduleSessionId` | `{ type: 'uuid' }` | `uuid NOT NULL` | ✅ |
| `UserStats.userId` | `{ type: 'uuid' }` | `uuid NOT NULL` | ✅ |
| `PersonalAccessToken.userId` | `'uuid'` (already correct) | `uuid NOT NULL` (already correct) | ✅ |

### FK cascade completeness

After this change, every table with a `userId` referencing `users.id` has `ON DELETE CASCADE`:
- `user_sessions` (existing) ✅
- `breath_sessions` (existing) ✅
- `breath_session_settings` (existing) ✅
- `change_events` (existing) ✅
- `user_stats` (added) ✅
- `module_sessions` (added) ✅
- `personal_access_tokens` (added) ✅

The `session_stream_samples.moduleSessionId → module_sessions.id` FK completes the two-hop cascade: deleting a user cascades to `module_sessions`, which cascades to `session_stream_samples`.

No FK on `activityRefId` — correct. `breath_sessions` rows are independent and outlive module sessions.

### Critical issues

None.

### Suggestions

None.

REVIEW_PASS
