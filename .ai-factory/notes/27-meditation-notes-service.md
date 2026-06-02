# Meditation Notes — Service Implementation

**Date:** 2026-06-02
**Source:** conversation context

## Key Findings

- Two methods: `create` (called once after session ends) and `updateText` (edits note_text by note UUID — future use).
- `create` inserts a new row; unique partial index on `session_id` prevents duplicates at DB level → throw `ALREADY_EXISTS` on `23505`.
- `updateText` takes note UUID + userId (ownership check) + noteText — only `noteText` is mutable, `poseName` and `sessionId` are immutable after creation.
- If FK violation fires on create (session deleted between stop and save), retry with `sessionId = null`.

## Details

### File: `src/meditation-notes/meditation-notes.service.ts`

#### `create`

```typescript
async create(
  userId: string,
  sessionId: string,
  poseName: string,
  noteText: string,
): Promise<MeditationNote> {
  const note = this.repo.create({ userId, sessionId, poseName, noteText });
  try {
    return await this.repo.save(note);
  } catch (err: any) {
    if (err?.code === '23505') {
      // Unique violation: a note for this session already exists.
      // This should not happen in normal mobile flow (one note per session end),
      // but guard with ALREADY_EXISTS so the caller can surface it cleanly.
      throw new RpcException({ code: GrpcStatus.ALREADY_EXISTS, message: 'Note for this session already exists' });
    }
    if (err?.code === '23503') {
      // FK violation: session was deleted between session-stop and note-save.
      // Detach and save without session reference — note still persists.
      note.sessionId = null;
      return this.repo.save(note);
    }
    throw err;
  }
}
```

#### `updateText`

Only `noteText` is mutable. `poseName` and `sessionId` are intentionally excluded from the update path.

```typescript
async updateText(
  noteId: string,
  userId: string,
  noteText: string,
): Promise<MeditationNote> {
  const note = await this.repo.findOneBy({ id: noteId });
  if (!note) {
    throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: 'Note not found' });
  }
  if (note.userId !== userId) {
    throw new RpcException({ code: GrpcStatus.PERMISSION_DENIED, message: 'Note belongs to another user' });
  }
  note.noteText = noteText;
  return this.repo.save(note);
}
```

#### `list`

Cursor-based pagination ordered by `createdAt DESC`. Page token is base64url-encoded ISO timestamp of the last returned item.

```typescript
async list(
  userId: string,
  pageSize: number,
  pageToken: string,
): Promise<{ notes: MeditationNote[]; nextPageToken: string }> {
  const limit = Math.min(pageSize || 20, 100);
  const qb = this.repo
    .createQueryBuilder('n')
    .where('n.userId = :userId', { userId })
    .orderBy('n.createdAt', 'DESC')
    .take(limit + 1);

  if (pageToken) {
    const cursor = Buffer.from(pageToken, 'base64url').toString('utf8');
    qb.andWhere('n.createdAt < :cursor', { cursor });
  }

  const rows = await qb.getMany();
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextPageToken = hasMore
    ? Buffer.from(items[items.length - 1].createdAt.toISOString()).toString('base64url')
    : '';

  return { notes: items, nextPageToken };
}
```

### What is NOT updatable

- `poseName` — immutable after creation; a pose change would be a new session with a new note.
- `sessionId` — immutable; session binding is set at creation and cleared only by DB on session deletion.

### Injection

`@InjectRepository(MeditationNote)` — confined to `MeditationNotesModule`.

## How to verify

Unit test: create two notes for the same user, call `list` with `pageSize=1`, verify `nextPageToken` is non-empty and the second page returns the second note. Integration test: call `create` twice for the same `sessionId` → second call throws `ALREADY_EXISTS`.
