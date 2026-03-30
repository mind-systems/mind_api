# Phase 11 — UUID Fix: Detailed Task Breakdown

## Scope

Four columns across three tables store UUIDs as `character varying` with no FK constraints.
All four must be fixed together — entity decorators and `InitialSchema` migration in sync.
Additionally, `personal_access_tokens.userId` already has the correct `uuid` type but is missing
a FK constraint — add `ON DELETE CASCADE` to close the last gap in user deletion cascading.

## Cascade requirement

User deletion must propagate completely:

```
users
  ├─ ON DELETE CASCADE → module_sessions
  │                        └─ ON DELETE CASCADE → session_stream_samples
  ├─ ON DELETE CASCADE → personal_access_tokens
  ├─ ON DELETE CASCADE → user_sessions
  ├─ ON DELETE CASCADE → breath_sessions
  ├─ ON DELETE CASCADE → breath_session_settings
  ├─ ON DELETE CASCADE → change_events
  └─ ON DELETE CASCADE → user_stats
```

Both FK constraints on the `module_sessions → session_stream_samples` chain are required.
Without `FK_session_stream_samples_moduleSessionId`, deleting a user cascades `module_sessions`
but leaves orphaned `session_stream_samples` rows.

## Entity changes

### `src/realtime/entities/module-session.entity.ts`

**Line 18–19** — replace stale comment:
```typescript
// No @ManyToOne — modules stay decoupled at the ORM level.
// FK constraint enforced in the InitialSchema migration.
```

**Line 20** — fix `userId`:
```typescript
// before
@Column()
userId: string;

// after
@Column({ type: 'uuid' })
userId: string;
```

**Line 26** — fix `activityRefId`:
```typescript
// before
@Column({ nullable: true })
activityRefId?: string;

// after
@Column({ type: 'uuid', nullable: true })
activityRefId?: string;
```

### `src/realtime/entities/session-stream-sample.entity.ts`

Fix `moduleSessionId` (exact line TBD — check file):
```typescript
// before
@Column()
moduleSessionId: string;

// after
@Column({ type: 'uuid' })
moduleSessionId: string;
```

### `src/stats/entities/user-stats.entity.ts`

**Line 14** — replace stale comment (same wording as module-session).

**Line 16** — fix `userId`:
```typescript
// before
@Column()
userId: string;

// after
@Column({ type: 'uuid' })
userId: string;
```

## Migration changes

File: `src/migrations/1774863293946-InitialSchema.ts`

### `user_stats` CREATE TABLE block

**Line 210** — fix `userId`:
```sql
-- before
"userId" character varying NOT NULL,
-- after
"userId" uuid NOT NULL,
```

Add FK constraint:
```sql
CONSTRAINT "FK_user_stats_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
```

### `personal_access_tokens` CREATE TABLE block

The `userId` column (line 244) already has the correct `uuid` type — no type change needed.
Add FK constraint after the existing UNIQUE constraint (line 250):
```sql
CONSTRAINT "FK_personal_access_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
```

### `module_sessions` CREATE TABLE block

**Line 261** — fix `userId`:
```sql
-- before
"userId" character varying NOT NULL,
-- after
"userId" uuid NOT NULL,
```

**Line 263** — fix `activityRefId`:
```sql
-- before
"activityRefId" character varying DEFAULT NULL,
-- after
"activityRefId" uuid DEFAULT NULL,
```

No FK on `activityRefId` — `breath_sessions` rows are independent and outlive module sessions.

Add FK constraint inside the `module_sessions` CREATE TABLE block:
```sql
CONSTRAINT "FK_module_sessions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
```

### `session_stream_samples` CREATE TABLE block

**Line 285** — fix `moduleSessionId`:
```sql
-- before
"moduleSessionId" character varying NOT NULL,
-- after
"moduleSessionId" uuid NOT NULL,
```

Add FK constraint:
```sql
CONSTRAINT "FK_session_stream_samples_moduleSessionId" FOREIGN KEY ("moduleSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE
```

### `down()` — no changes needed

`DROP TABLE IF EXISTS` in reverse-dependency order already handles cascade cleanup.

## Commit plan

- **Commit 1** — entity decorators + stale comment updates
- **Commit 2** — InitialSchema migration fixes (including personal_access_tokens FK)
