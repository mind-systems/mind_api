# Plan Review: Add `MEDITATION` to `ActivityType` enum

**Plan:** `.ai-factory/plans/30-add-meditation-to-activitytype-enum-proto-typescript-and-migration.md`
**Risk Level:** 🔴 High — one assumption is wrong and will cause a runtime rejection of all `MEDITATION` activity-start commands.

### Context Gates
- **Architecture (`.ai-factory/ARCHITECTURE.md`):** not present — WARN.
- **Rules (`.ai-factory/RULES.md`):** not present — WARN.
- **Roadmap (`.ai-factory/ROADMAP.md`):** not checked for this plan (matches the milestone `30-…`).

### Critical Issues

#### 1. The plan's "no downstream code changes" assumption is wrong — `mapProtoActivityType` rejects everything except `BREATH`

Plan text (Context, paragraph 1):
> No downstream code changes are needed in `mind_api` — the realtime controller, instruction engine, and biometric stream are activity-type-agnostic and pass `activity_type` straight through.

The realtime controller is **not** activity-type-agnostic. In `src/realtime/module-state.grpc.controller.ts:33-41`:

```ts
function mapProtoActivityType(proto: ProtoActivityType): InternalActivityType {
  if (proto === ProtoActivityType.BREATH) {
    return InternalActivityType.BREATH;
  }
  throw new RpcException({
    code: GrpcStatus.INVALID_ARGUMENT,
    message: `Unsupported activity type: ${proto}`,
  });
}
```

This is called from `TrackActivity` on every `ActivityStartCmd` (line 259). Any client that sends `ActivityType.MEDITATION` after this plan is implemented will be rejected with `INVALID_ARGUMENT` / `INVALID_ACTIVITY_TYPE`. The proto enum, the TS enum, and the DB enum will all accept `MEDITATION`, but the gateway will not.

**Required additional task** (Phase 2 or new Phase 2b):
- Update `mapProtoActivityType` to also map `ProtoActivityType.MEDITATION → InternalActivityType.MEDITATION`. Keep the default-throws branch for `ACTIVITY_TYPE_UNSPECIFIED` and `UNRECOGNIZED`.
- Suggested implementation: convert the `if` chain into a `switch (proto)` with explicit cases for `BREATH` and `MEDITATION`, default → throw. This pattern surfaces the next missing case the same way (compile-time exhaustiveness can be enforced with `const _exhaustive: never = proto;` in the default branch).
- File: `src/realtime/module-state.grpc.controller.ts` (line 33).

Without this, Phase 4 Task 6/7 "verify" only proves the migration ran — it does not exercise the end-to-end path, so the bug will ship.

### Issues

#### 2. Stats service silently drops meditation sessions from complexity tracking — acknowledge or scope explicitly

`src/stats/stats.service.ts:101`:
```ts
if (event.activityType === ActivityType.BREATH && event.activityRefId) { ... }
```

This is a `BREATH`-gated branch that reads `breath_sessions.complexity`. Meditation sessions will skip this branch (correct — there is no `meditation_sessions` table yet). That's fine, but the plan does not state it. Recommend adding one line to **Assumptions / Notes**:

> Stats complexity tracking in `stats.service.ts` is gated on `activityType === BREATH` and will silently skip meditation sessions. This is intentional for this milestone; a separate roadmap item will introduce meditation-specific stats.

This is documentation, not a code change.

#### 3. `module-session.entity.ts` declares `@Column({ type: 'enum', enum: ActivityType })` — entity vs. DB will stay in sync only because `synchronize: false`

The entity declares the enum inline. Once `MEDITATION` is added to the TypeScript enum, TypeORM's metadata will include `'meditation'` and the DB enum will include `'meditation'`. Good — no drift.

But if anyone ever runs `typeorm migration:generate` (not used in this project per `CLAUDE.md`, but possible), it would emit a redundant `ALTER TYPE … ADD VALUE` migration. Not a blocker — flagging as a small note.

### Positive Notes

- **Enum name correction is correct.** Verified `src/migrations/1774863293946-InitialSchema.ts:33` — the type is `public.activity_type_enum`, not `module_sessions_activitytype_enum`. The milestone description was wrong; the plan caught and corrected this.
- **Enum value case is correct.** `'breath'` is lowercase in both Postgres and TypeScript; `'meditation'` follows the same convention. Proto identifier `MEDITATION` (uppercase) is independent of the wire string — plan correctly explains why.
- **Migration is idempotent.** `ALTER TYPE … ADD VALUE IF NOT EXISTS` is safe on retry, and Postgres 12+ allows this inside a transaction (the historical restriction was on using the new value in the same transaction, which this migration does not do). The fallback note about `transaction: false` is good defensive thinking.
- **No-op `down` is the right call.** Postgres has no `DROP VALUE`; a real rollback would require recreating the type and rewriting `module_sessions.activityType`. Document and move on.
- **CLI scaffolding is enforced** per the project memory rule about never hand-crafting migration timestamps.
- **Commit plan is clean** — proto+TS together (one logical unit), migration separate (deploys independently), optional drift fix last.

### Required Plan Updates Before Implementation

1. Add **Task 3b** (or new Phase 2 task) under Phase 2: "Extend `mapProtoActivityType` in `src/realtime/module-state.grpc.controller.ts` to handle `MEDITATION`." Depends on Task 1 (proto) and Task 3 (TS enum). Update Commit 1 to include this file alongside the proto + TS enum changes — it's part of the same logical change.
2. Update the **Context** paragraph: replace "No downstream code changes are needed" with an explicit list of the touched files (proto, TS enum, `mapProtoActivityType`, migration), so the assumption can't silently re-appear.
3. Optionally add the stats note (issue #2 above) to **Assumptions / Notes**.

