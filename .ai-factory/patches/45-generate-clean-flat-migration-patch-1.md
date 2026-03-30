# Patch: 45-generate-clean-flat-migration

Addresses the suggestion from review-1: `breath_sessions` columns use `TIMESTAMP WITH TIME ZONE` in the migration but the entity uses bare decorators that default to `TIMESTAMP WITHOUT TIME ZONE`.

## Fix approach

**Option A — align migration to entity.** The entity is the source of truth for TypeORM column types. Every other table with untyped `@CreateDateColumn()` uses plain `TIMESTAMP` in the migration. `breath_sessions` should do the same.

---

## Fix 1: Change `breath_sessions` column types from TIMESTAMPTZ to TIMESTAMP

**File:** `src/migrations/1774863293946-InitialSchema.ts`
**Lines:** 145–147

**Problem:** `createdAt`, `updatedAt`, and `deletedAt` are declared as `TIMESTAMP WITH TIME ZONE` but the `BreathSession` entity (`src/breath-sessions/entities/breath-session.entity.ts`) uses bare `@CreateDateColumn()`, `@UpdateDateColumn()`, `@DeleteDateColumn()` without `type: 'timestamptz'`. TypeORM's PostgreSQL default for these decorators is `TIMESTAMP WITHOUT TIME ZONE`.

**Replace:**
```sql
        "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"   TIMESTAMP WITH TIME ZONE DEFAULT NULL,
```

**With:**
```sql
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt"   TIMESTAMP DEFAULT NULL,
```

**Why `DEFAULT now()` instead of `DEFAULT CURRENT_TIMESTAMP`:** Every other table's `@CreateDateColumn()` / `@UpdateDateColumn()` in this migration uses `DEFAULT now()`. Using the same function keeps the migration internally consistent. (Both are equivalent in PostgreSQL.)

---

## Verification

After applying:
1. `npx tsc --noEmit` — must pass with zero errors
2. `make db-reset` — new migration runs against empty database without errors
3. Spot-check: `\d breath_sessions` in psql — `createdAt`, `updatedAt`, `deletedAt` should show `timestamp without time zone`, matching `users.createdAt`, `auth_codes.createdAt`, etc.
