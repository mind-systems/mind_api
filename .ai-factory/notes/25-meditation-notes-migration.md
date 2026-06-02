# Meditation Notes — Migration AddMeditationNotesTable

**Date:** 2026-06-02
**Source:** conversation context

## Key Findings

- New `meditation_notes` table; `session_id` FK must be `ON DELETE SET NULL` (not CASCADE) so notes survive session deletion.
- Unique constraint on `session_id` (partial, where not null) — one note per session, enforced at DB level.
- Column is `pose_name` (varchar, opaque string from client), not `pose_id` — no FK to any table.

## Details

### Generate the file

```bash
npx typeorm migration:create src/migrations/AddMeditationNotesTable
```

Never hand-craft the timestamp prefix.

### `up` body

```sql
CREATE TABLE meditation_notes (
  id         uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid         REFERENCES module_sessions(id) ON DELETE SET NULL,
  pose_name  varchar      NOT NULL,
  note_text  text         NOT NULL DEFAULT '',
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now()
);

-- backs ListNotes query (filter by user)
CREATE INDEX IDX_meditation_notes_user_id ON meditation_notes (user_id);

-- backs FK lookup on session deletion
CREATE INDEX IDX_meditation_notes_session_id ON meditation_notes (session_id);

-- one note per session (partial: allows multiple null session_ids for detached notes)
CREATE UNIQUE INDEX UQ_meditation_notes_session
  ON meditation_notes (session_id)
  WHERE session_id IS NOT NULL;
```

### `down` body

```sql
DROP TABLE IF EXISTS meditation_notes;
```

### Critical guard

`session_id` FK MUST be `ON DELETE SET NULL`. Using `ON DELETE CASCADE` would delete note rows when sessions are deleted — exactly the failure mode the deletion policy is designed to prevent. With `SET NULL`, the DB automatically detaches notes from deleted sessions; no application logic is needed for the basic detach behavior.

### `pose_name` is opaque

`pose_name` is a client-side string label (e.g. `"lotus"`, `"easy"`). The server accepts any value without validation — it is denormalized by design so the note remains self-contained even if the session row is gone. No FK, no check constraint.

### Deletion policy

- On session row deletion: `ON DELETE SET NULL` sets `note.session_id = null` automatically. Note row survives.
- Multiple detached notes (session_id = null) for the same user are allowed — the partial unique index only covers non-null session_ids. The service layer ensures dedup at note-ID level (updates go by note UUID, not by session_id).

## How to verify

`npm run migration:run` succeeds. `\d meditation_notes` in psql shows nullable `session_id`, the partial unique index, and both regular indexes.
