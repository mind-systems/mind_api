# Change Events Sync — API Architecture Notes

## Overview

Server-initiated data sync for external mutations (MCP, future web, admin).
One source of truth (`change_events` table) + two delivery channels (WebSocket push, REST poll).

## change_events Table

```sql
id            SERIAL PRIMARY KEY        -- monotonic cursor
entity        VARCHAR NOT NULL           -- "breath_session", future: "meditation", etc.
ref_id        UUID NOT NULL              -- entity PK
action        VARCHAR NOT NULL           -- "created" | "updated" | "deleted"
user_id       UUID NOT NULL REFERENCES users(id)  -- recipient (who should know)
created_at    TIMESTAMP DEFAULT now()
```

Index: `(user_id, id)` — covers the main query pattern.

No `updatedAt` from entity needed — the client will refetch the entity itself.

## ChangeLogService

- `log(entity, refId, action, userId)` — writes one row
- `logForRecipients(entity, refId, action, userIds[])` — writes N rows (shared scenario)
- `getChanges(userId, afterId, limit=100)` — returns events + `hasMore` flag
- `getMinEventId()` — for full resync detection
- `purge(olderThanDays=30)` — scheduled cleanup

## Integration Points

Every mutation in service layer explicitly calls `changeLogService.log()`:

```ts
// BreathSessionsService
async update(id, userId, dto) {
  const session = await this.repo.save(...);
  await this.changeLogService.log("breath_session", id, "updated", userId);
  return session;
}
```

For shared sessions — determine recipients and log per-user:
```ts
const recipients = await this.getSessionRecipients(sessionId);
await this.changeLogService.logForRecipients("breath_session", id, "updated", recipients);
```

## Soft Delete

`breath_sessions` needs `deletedAt: Date | null` column. All queries filter `WHERE deletedAt IS NULL`.
Delete mutation sets `deletedAt = now()` instead of removing the row, then logs a "deleted" change event.

## REST Sync Endpoint

```
GET /sync/changes?after=123&limit=100
Authorization: Bearer <jwt>
```

Response:
```json
{
  "events": [
    { "id": 124, "entity": "breath_session", "refId": "uuid", "action": "updated" },
    { "id": 125, "entity": "breath_session", "refId": "uuid2", "action": "deleted" }
  ],
  "cursor": 125,
  "hasMore": false
}
```

Full resync fallback:
```json
{ "fullResync": true }
```
Returned when `after < minAvailableEventId` (client was offline too long, events purged).

## Batch Fetch Endpoint

```
GET /breath_sessions/batch?ids=uuid1,uuid2,uuid3
Authorization: Bearer <jwt>
```

Returns array of sessions matching the IDs. Needed so the client doesn't make N individual requests after receiving N change events.

## WebSocket Push

New event on `/live` namespace. Socket carries the **events themselves**, not just a signal:
```json
{
  "event": "sync:changed",
  "payload": {
    "events": [
      { "id": 124, "entity": "breath_session", "refId": "uuid", "action": "updated" },
      { "id": 125, "entity": "breath_session", "refId": "uuid2", "action": "deleted" }
    ]
  }
}
```

This way the online client **skips `GET /sync/changes`** and goes directly to `GET /breath_sessions/batch?ids=...` — one request instead of two.

Debounce per userId (300ms window): multiple rapid mutations → single socket emit with accumulated events.

Implementation: in-memory `Map<userId, { timer, events[] }>` in a `SyncNotifierService`.
On mutation → `notify(userId, event)`. If timer pending, append to events array. If not, start 300ms timer → emit all accumulated events on expiry.

### Two delivery paths, same data

```
ONLINE:  socket delivers events  →  client batch-refetches  →  1 request
OFFLINE: GET /sync/changes       →  client batch-refetches  →  2 requests (cold start)
```

The client processes events identically regardless of source — same grouping, same batch refetch, same Drift update.

## TTL & Cleanup

- Cron job: daily, delete events older than 30 days
- If client's `afterId` < oldest available event → respond with `{ fullResync: true }`
- Client on full resync: clear Drift cache, do normal paginated fetch
