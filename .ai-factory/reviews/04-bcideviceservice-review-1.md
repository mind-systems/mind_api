# Code Review: `04-bcideviceservice` (BciDeviceService implementation)

**Scope:** `src/bci/bci-device.service.ts` (only code file changed). Plan and plan-review files reviewed for documentation correctness only.

## Files reviewed

- `src/bci/bci-device.service.ts` — implementation under review (read in full)
- `src/bci/entities/bci-device.entity.ts` — entity contract (verified column mappings)
- `src/migrations/1779369537954-AddBciDevicesTable.ts` — DB contract (verified `UQ_bci_devices_user_serial`, `FK_bci_devices_user_id ON DELETE CASCADE`, `IDX_bci_devices_user_id`)
- `src/grpc/grpc-exception.filter.ts` — exception translation behaviour (only catches `HttpException`)
- `src/realtime/sync-stream.grpc.controller.ts` — referenced as the import-style precedent for `RpcException` + `status as GrpcStatus`
- `src/users/service/session.service.ts` — referenced as the `Repository.update(...)` precedent

## Plan adherence

The implementation matches the plan task-for-task:

- **Task 1** (`listForUser`) — uses `find({ where: { userId }, order: { updatedAt: 'DESC' } })`. ✓
- **Task 2** (`register`) — uses pattern (a): `update({ userId, serial }, { updatedAt: () => 'CURRENT_TIMESTAMP' })` followed by `findOneByOrFail`, with `QueryFailedError` + `code === '23505'` re-fetch on race. ✓
- **Task 3** (`delete`) — two-step `findOneBy` → ownership check → `delete`, raising `NOT_FOUND` / `PERMISSION_DENIED` via `RpcException`. ✓
- Imports added exactly as instructed: `QueryFailedError` folded into the existing `typeorm` import; `RpcException` from `@nestjs/microservices`; `status as GrpcStatus` from `@grpc/grpc-js`. ✓

## Findings

### Minor — `findOneByOrFail` after `repo.update` can throw an untranslated `EntityNotFoundError`

`register` (lines 25–31):

```ts
const updateResult = await this.bciDevicesRepo.update(
  { userId, serial },
  { updatedAt: () => 'CURRENT_TIMESTAMP' },
);
if ((updateResult.affected ?? 0) > 0) {
  return this.bciDevicesRepo.findOneByOrFail({ userId, serial });
}
```

If a concurrent `delete` removes the row between the `UPDATE` and the `findOneByOrFail` (or the `users` FK cascade fires due to the user being deleted), `findOneByOrFail` throws TypeORM's `EntityNotFoundError`. `GrpcExceptionFilter` only catches `HttpException` (`src/grpc/grpc-exception.filter.ts:30`), so this error propagates raw to the gRPC transport and the client sees a non-specific `UNKNOWN` / `INTERNAL` status.

The same applies to the `findOneByOrFail` inside the `QueryFailedError` catch branch (line 45) — same race, same fallthrough.

Practically the window is microseconds and a concurrent delete-during-register is extremely unlikely for paired hardware, so this is a minor finding. If you want to harden it, either:
- catch `EntityNotFoundError` and treat it as the "no row found" branch (fall through to the insert path or return after another insert), or
- use `findOneBy` and explicitly check for null, mapping null to an `RpcException`.

Not a blocker for this milestone.

### Minor — `Repository.delete` race silently no-ops on concurrent removal

`delete` (lines 51–66) reads, checks ownership, then deletes. If another writer (or an `ON DELETE CASCADE` from `users`) removes the row between `findOneBy` and `repo.delete`, the second call returns `affected: 0` and the method resolves successfully. From the client's perspective this is indistinguishable from a successful delete, which is the desired idempotent outcome for a delete RPC — so no action needed. Worth being aware of.

### Note — `QueryFailedError.code` access pattern is correct but unprecedented in this repo

```ts
(err as QueryFailedError & { code?: string }).code === '23505'
```

The `pg` driver attaches SQLSTATE codes (`23505` = unique_violation) to the thrown error, and TypeORM re-exposes them on `QueryFailedError`. The cast is valid. This is the first usage of `QueryFailedError` in `src/` (verified — no other file imports it), so there's no in-repo precedent to compare against. The pattern is conventional and matches widespread community usage; accept as-is.

### Note — Ownership semantics are correct, not collapsible

The plan explicitly forbids collapsing ownership into a single `findOneBy({ id, userId })`, because the milestone requires distinguishing `NOT_FOUND` (no row with that id at all) from `PERMISSION_DENIED` (row exists but belongs to another user). The implementation correctly preserves that distinction. ✓

### Note — `delete` as a method name

`delete` is a JS reserved word but is legal as a class method name. TypeScript accepts it, and `this.bciDevicesRepo.delete(...)` inside the body is unambiguous (property access). The milestone explicitly names the method `delete`, so this is intentional. No issue.

## Verified non-issues

- **`UpdateDateColumn` won't fire from `.save(unchanged)`** — the milestone trap. The code correctly uses `repo.update(..., { updatedAt: () => 'CURRENT_TIMESTAMP' })` rather than loading-and-saving, so the bump happens via raw SQL and the `List` ordering will reflect re-pair. ✓
- **`updatedAt` not re-bumped in the race-loser branch (line 45)** — correct. The concurrent writer already set `updated_at = now()` via the insert default. Adding another bump would be a wasted round-trip and could mask the actual re-pair time. ✓
- **Unique-violation re-fetch correctness** — `UQ_bci_devices_user_serial` is on `(user_id, serial)`, which is exactly the filter passed to `findOneByOrFail`, so the row is guaranteed to be uniquely identified. ✓
- **Index coverage** — `listForUser`'s `WHERE user_id = $1` is backed by `IDX_bci_devices_user_id`. ORDER BY `updated_at DESC` is unindexed but row count per user is small (one or two paired devices in practice), so a sort is fine. ✓
- **No logging of `serial`** — matches `.ai-factory/RULES.md` "Never log sensitive data" / "Keep logs lean". The service has no Logger at all, consistent with the plan's "minimal" logging setting. ✓
- **No `!` non-null assertions** — uses `(updateResult.affected ?? 0) > 0` and explicit null check on `row`. Complies with the rule in `RULES.md`. ✓
- **No `@InjectRepository` leakage** — `BciDevice` is only injected here, inside its owning `BciModule`. Modular monolith boundary preserved. ✓
- **gRPC status codes** — `NOT_FOUND` and `PERMISSION_DENIED` match the milestone description verbatim and the import style matches `src/realtime/sync-stream.grpc.controller.ts`. ✓

## Summary

Implementation is correct and follows the plan exactly. The two minor findings (race-window `EntityNotFoundError` from `findOneByOrFail`, silent no-op on concurrent delete) are real but extremely unlikely edge cases and not worth blocking the milestone over. The controller wiring in the next milestone is the appropriate place to add an integration-level guard if desired.

REVIEW_PASS
