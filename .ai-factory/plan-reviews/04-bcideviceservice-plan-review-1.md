# Plan Review: `04-bcideviceservice.md`

**Plan Reviewed:** `BciDeviceService` implementation (Phase 16, milestone 4)
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md (Modular Monolith):** PASS. Plan keeps `@InjectRepository(BciDevice)` inside `BciModule`, ownership/business logic lives in the service (not the controller), and no other module is touched. Aligned with the rule that "entities stay in their module."
- **RULES.md:** PASS. Plan explicitly avoids non-null assertions (`!`), avoids entry/exit logging, and notes that `serial` is treated as PII-adjacent ("Never log sensitive data" / "Keep logs lean"). The reasoning is called out inline.
- **ROADMAP.md (Phase 16, milestone 4):** PASS. Plan implements the milestone verbatim: `listForUser` ordered by `updated_at DESC`; `register` idempotent with explicit `@UpdateDateColumn` bump and 23505 race-handling; `delete` with `NOT_FOUND` / `PERMISSION_DENIED` ownership semantics. Pattern (a) (`repo.update(..., { updatedAt: () => 'CURRENT_TIMESTAMP' })`) is chosen — matches the roadmap's first option.

## Codebase Alignment

- **Stub file:** `src/bci/bci-device.service.ts` currently exists exactly as the plan describes (constructor + `@InjectRepository(BciDevice)`, empty body). The plan's instruction to "replace the empty body" is correct.
- **Entity columns:** `BciDevice` has `userId`, `serial`, `createdAt`, `updatedAt` with `@UpdateDateColumn({ name: 'updated_at' })`. Plan's references match.
- **Migration:** `1779369537954-AddBciDevicesTable.ts` already creates `IDX_bci_devices_user_id` and `UQ_bci_devices_user_serial` — so the plan's reliance on these for `List` ordering and unique-violation race detection is grounded in shipped code. No new migration is needed for this milestone (plan correctly does not propose one).
- **Reference patterns:** `src/realtime/sync-stream.grpc.controller.ts` does use `import { status as GrpcStatus } from '@grpc/grpc-js'` and `RpcException` from `@nestjs/microservices` — plan's import instructions are accurate. `Repository.find({ where, order })` usage in `src/realtime/services/startup-recovery.service.ts` confirms the project convention referenced in Task 1.

## Findings

### Minor — `QueryFailedError.code` access pattern

In Task 2, the plan reads the SQLSTATE via:

```ts
(err as QueryFailedError & { code?: string }).code === '23505'
```

This works because the `pg` driver attaches `code` to the underlying error object, and TypeORM re-exposes those properties on `QueryFailedError`. However, this is the **first** usage of `QueryFailedError` in the codebase (verified — no other file imports it), so there's no precedent to follow. The cast is correct for `pg` but worth noting that some teams prefer `(err.driverError as { code?: string }).code` for clarity. Not a blocker — the chosen approach is valid and common.

### Minor — `findOneByOrFail` after `update` can throw on concurrent delete

Task 2's fast path:

```ts
const updateResult = await this.bciDevicesRepo.update({ userId, serial }, ...);
if ((updateResult.affected ?? 0) > 0) {
  return this.bciDevicesRepo.findOneByOrFail({ userId, serial });
}
```

If a concurrent `delete` removes the row between `UPDATE` and `findOneByOrFail`, the latter throws `EntityNotFoundError`. The race window is tiny and the client can retry — acceptable for a register flow — but it's worth being aware of. No action needed.

### Note — Phase 2 verification scope

Task 4 runs `npm run build` and `npm run lint` only. The controller (next milestone) is what actually wires these methods to the gRPC surface, so runtime verification is correctly deferred. This aligns with the milestone slicing in ROADMAP.md.

## Positive Notes

- Plan reasoning is explicit about *why* `.save(unchanged)` doesn't bump `@UpdateDateColumn` — that's exactly the trap the milestone description warned about.
- Ownership check is correctly placed in the service (not the controller), matching the `PERMISSION_DENIED` vs `NOT_FOUND` semantics required by the milestone (two-step fetch-then-check rather than collapsing both into a `findOneBy({ id, userId })`).
- Both error paths in `register` (existing-row update + insert-race) are handled, and the inline comment explains why no `updatedAt` bump is needed in the race-loser branch (other writer already set it).
- Logging stance is justified by reference to `RULES.md`, not just asserted.
- Import additions are surgical and reuse the existing typeorm import line.

PLAN_REVIEW_PASS
