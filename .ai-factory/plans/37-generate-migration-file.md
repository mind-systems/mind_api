# Plan: Generate migration file

## Context
Scaffold an empty TypeORM migration named `RenameToModuleSessions` using the CLI so the timestamp is auto-generated.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Generate migration

- [x] **Task 1: Run the TypeORM migration:create CLI command**
  Files: `src/migrations/<timestamp>-RenameToModuleSessions.ts` (auto-generated)
  Execute `npx typeorm migration:create src/migrations/RenameToModuleSessions` from the `mind_api/` directory. This produces an empty migration class with a correct timestamp prefix. Do not hand-craft the timestamp or edit the generated file name.
