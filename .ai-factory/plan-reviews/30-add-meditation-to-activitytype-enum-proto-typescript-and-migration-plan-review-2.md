# Plan Review (v2): Add `MEDITATION` to `ActivityType` enum

**Plan:** `.ai-factory/plans/30-add-meditation-to-activitytype-enum-proto-typescript-and-migration.md`
**Previous review:** `.ai-factory/plan-reviews/30-…-plan-review-1.md`
**Risk Level:** 🟢 Low — all v1 issues are resolved; spot-checks against the codebase confirm the plan's claims.

### Context Gates
- **Architecture (`.ai-factory/ARCHITECTURE.md`):** present. Plan is consistent with the "Modular Monolith / entities belong to their module" rule — all four touch points stay within `proto/`, `src/realtime/`, and `src/migrations/`. No cross-module reach. **OK**.
- **Rules (`.ai-factory/RULES.md`):** present. The relevant rules — "no non-null assertion", "no sensitive logging", "keep logs lean", "always use `@Payload()` with `@GrpcCurrentUser()`" — do not apply to any of the planned edits (no logging added, no new gRPC handlers, no decorators changed). **OK**.
- **Roadmap (`.ai-factory/ROADMAP.md`):** present. Milestone `30-…` matches the plan title; no roadmap reconciliation needed.

### Resolved from v1

1. **`mapProtoActivityType` rejection bug (v1 Critical Issue #1).** Resolved. New Task 4 in Phase 2 converts the `if` chain into a `switch (proto)` with explicit `BREATH` and `MEDITATION` cases plus an exhaustive `default` throw, and the Context section now lists the gateway as touch point #3 ("today it throws `INVALID_ARGUMENT` for anything other than `BREATH`"). The optional `const _exhaustive: never = proto;` line is mentioned as a guard against future drift. Commit 1 correctly bundles proto + TS enum + gateway change as one atomic logical unit.

2. **Stats service gating note (v1 Issue #2).** Resolved. Assumptions section now contains: "Stats are intentionally not extended … gates complexity tracking on `activityType === ActivityType.BREATH && event.activityRefId`. Meditation sessions will silently skip that branch — correct for this milestone, since there is no `meditation_sessions` table or complexity model yet."

3. **Entity drift note (v1 Issue #3).** Resolved. Assumptions section now states the entity metadata and DB type stay aligned and that no `synchronize` is ever run.

### Codebase Verification

Spot-checked the plan's specific factual claims against the repo:

- `src/realtime/enums/activity-type.enum.ts` currently contains exactly `BREATH = 'breath'` — confirms the lowercase convention claim and the Task 3 patch surface.
- `proto/module_state.proto` line 13–16 defines `ActivityType` with `ACTIVITY_TYPE_UNSPECIFIED = 0; BREATH = 1;`. Line 12 contains the comment "Only one real member for now; the enum is the extension point for future activity types." — matches Task 1's quoted line numbers and rewrite.
- `src/realtime/module-state.grpc.controller.ts:33-41` contains the `if (proto === ProtoActivityType.BREATH) … throw RpcException` chain exactly as the plan describes. Task 4's target line and surrounding signature (`function mapProtoActivityType(proto: ProtoActivityType): InternalActivityType`) match.
- `src/migrations/1774863293946-InitialSchema.ts:33` defines `CREATE TYPE "public"."activity_type_enum" AS ENUM('breath')`, and line 264 declares `"activityType" "public"."activity_type_enum" NOT NULL` on `module_sessions`. The plan's enum-name correction (`activity_type_enum`, not `module_sessions_activitytype_enum`) is correct.
- `src/stats/stats.service.ts:101` gates on `event.activityType === ActivityType.BREATH && event.activityRefId` exactly as the plan quotes — the silent-skip claim for meditation is accurate.
- `proto/generated/module_state.ts` exists; `npm run proto:gen` script is wired correctly in `package.json` (`protoc … --ts_proto_out=./proto/generated …`). Task 2 will regenerate correctly.

### Minor Observations (non-blocking)

- **Task 4 default-branch exhaustiveness check.** `const _exhaustive: never = proto;` will work only after `mapProtoActivityType` handles every `ProtoActivityType` member that can reach it. Since `ACTIVITY_TYPE_UNSPECIFIED` and `UNRECOGNIZED` are still routed to the throwing `default`, the assignment to `never` will be a compile error today unless those two are narrowed out earlier — TypeScript will see `ACTIVITY_TYPE_UNSPECIFIED | UNRECOGNIZED` reaching the default and refuse `: never`. Two safe shapes for Task 4:
  - Omit the `_exhaustive` line entirely (the plan does say "optionally"); the explicit `switch` + `default → throw` already guards runtime safety.
  - Or, before the throw, switch on `proto` again with cases for `ACTIVITY_TYPE_UNSPECIFIED` and `UNRECOGNIZED` that fall through to the throw, leaving an unreachable `never` slot. This is more bookkeeping than the win is worth — the simpler option is to skip `_exhaustive`.
  Either is fine; flagging so the implementer doesn't get a TS2322 surprise and revert the whole switch.

- **Task 7 psql verification command.** `psql … -c "SELECT unnest(enum_range(NULL::activity_type_enum));"` is correct but uses an unqualified type name; if the implementer runs it against a connection without `public` on `search_path` it will fail. Either qualify (`NULL::public.activity_type_enum`) or rely on default `search_path`. Trivial.

- **Migration `down` body.** Plan says "leave the method body empty except for a comment". TypeORM still wants a `down(queryRunner: QueryRunner): Promise<void>` method — make sure it returns (e.g. an explicit `return;` or just an `async` empty body). The scaffolded class will already have the signature; just don't delete it.

None of these are blockers — implementer will hit them in seconds and resolve inline.

### Positive Notes

- v1 issues were addressed cleanly and substantively, not just acknowledged.
- The Context section now states all four touch points up front; the wrong "no downstream code changes" assumption from v1 is gone.
- Task ordering and dependencies (`Task 4` depends on Tasks 2 + 3; Task 7 depends on Tasks 3 + 6; Task 8 depends on Tasks 2 + 3 + 4) are correct.
- Commit plan groups by logical unit (gateway change ships with proto + enum) and keeps the migration as a separate deploy artifact.
- Plan correctly insists on CLI-scaffolded migration timestamps, matching the project's recorded feedback rule.
- Explicit acknowledgment of the Postgres "ALTER TYPE … ADD VALUE inside transaction" caveat with a `transaction: false` fallback is the right level of defensive thinking.

PLAN_REVIEW_PASS
