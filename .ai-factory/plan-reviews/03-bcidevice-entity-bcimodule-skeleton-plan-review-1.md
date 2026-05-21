# Plan Review: `BciDevice` entity + `BciModule` skeleton

**Plan reviewed:** `.ai-factory/plans/03-bcidevice-entity-bcimodule-skeleton.md`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md (modular monolith):** ✅ Plan respects the dependency rules — no `@ManyToOne(() => User)` relation, no cross-module entity reach-ins, `@InjectRepository(BciDevice)` confined to `BciModule`, `BciModule.exports` empty. New folder `src/bci/` matches the `src/[feature]/` template (`entities/`, `dto/`, `<feature>.module.ts`, `<feature>.service.ts`, `<feature>.grpc.controller.ts`).
- **RULES.md:** ✅ Plan does not violate any rule. No `!` operator, no logging of sensitive data, no `@GrpcCurrentUser()` usage (stubs only — relevant rule will apply in the next milestone).
- **ROADMAP.md:** ✅ Aligns with Phase 16 third bullet ("`BciDevice` entity + `BciModule` skeleton"). The plan correctly defers `listForUser` / `register` / `delete` logic to the next milestone and is well-scoped.

## Codebase Cross-Check

Each fact the plan relies on was verified against the source:

- **Migration alignment** — `src/migrations/1779369537954-AddBciDevicesTable.ts` exists with columns `id (uuid)`, `user_id (uuid)`, `serial (varchar)`, `created_at (timestamptz)`, `updated_at (timestamptz)`, PK on `id`, `UQ_bci_devices_user_serial (user_id, serial)`, FK on `user_id ... ON DELETE CASCADE`, plus `IDX_bci_devices_user_id`. The entity in Task 1 maps one-to-one to those columns and the unique constraint via the class-level `@Index(['userId', 'serial'], { unique: true })`. Since `synchronize: false`, the `@Index` decorator is purely metadata and won't collide with the existing DB-level `UQ_…` constraint. ✓
- **Column-style template** — `src/device/entities/device.entity.ts` uses explicit `name: 'snake_case'` mapping and `type: 'timestamptz'` for date columns, exactly the convention Task 1 prescribes. ✓
- **Controller decorators / imports** — `src/realtime/sync-stream.grpc.controller.ts` does use `@Controller()` + `@UseFilters(GrpcExceptionFilter)` + `@UseInterceptors(GrpcAuthInterceptor)` (note: it imports them via relative `'../grpc/...'`, whereas the plan uses absolute `'src/grpc/...'`). The absolute style is valid because `tsconfig.json` declares `paths: { "src/*": ["src/*"] }` and other files in the repo (e.g. `breath-sessions/*`, `sync/*`) already import that way. Both styles work — no blocker. ✓
- **`src/grpc/` contents** — `grpc-exception.filter.ts` and `grpc-auth.interceptor.ts` exist exactly at the paths used in the plan. ✓
- **`src/device/device.module.ts`** — Confirms the wiring template (`TypeOrmModule.forFeature([…])`, controllers, providers, no exports). The plan's `BciModule` mirrors it precisely. ✓
- **`AppModule` insertion point** — `src/app.module.ts` line 32 is `BreathSessionsModule,`; inserting `BciModule,` immediately after lines up with both the plan and the roadmap wording ("next to `BreathSessionsModule`"). ✓
- **DTO style** — `src/breath-sessions/dto/breath-session.dto.ts` uses `class-validator` with `@IsString() @IsNotEmpty()` exactly as Task 2 prescribes. ✓
- **ESLint config (`eslint.config.mjs`)** — Uses `tseslint.configs.recommendedTypeChecked` with `no-explicit-any` disabled and `no-floating-promises` as warn. Stub class properties injected via constructor will not be flagged as unused (TS-ESLint's `no-unused-vars` does not apply to class members). `npm run lint` should pass on the new files. ✓

## Findings

### Critical Issues
None.

### Minor Notes (non-blocking)

1. **Import style inconsistency (cosmetic).** The stub controller uses absolute `'src/grpc/...'` imports while the closest analog (`src/realtime/sync-stream.grpc.controller.ts`) uses relative `'../grpc/...'`. Both compile because `tsconfig.json` defines the `src/*` path alias, but staying consistent with the *closest* existing controller would be marginally cleaner. Not worth blocking on — other files in the repo already mix both styles.

2. **`bciDevicesRepo` unused in the stub service.** Intentional and correctly justified in the plan (validates that DI wiring resolves before the next milestone adds methods). `private readonly` constructor-injected fields are not flagged by `tseslint`'s `no-unused-vars`, so `npm run lint` will pass.

3. **Empty stub controller class.** A `@Controller()` with no `@GrpcMethod` handlers is valid NestJS — Nest registers no routes and the bootstrap succeeds. Verified against how `nest build` and the gRPC microservice transport behave.

### Positive Notes

- Excellent justification for *why* the entity must not have a `@ManyToOne(() => User)` relation (modular monolith boundary) — this is exactly the kind of detail that prevents the next agent from "helpfully" adding it back.
- Task 4 explicitly tells the agent to verify the filter/interceptor import paths before writing — defensive instruction that prevents copy-paste errors.
- Commit plan splits cleanly: pure data layer first (entity + DTO), then wiring (service + controller + module + AppModule).
- Verification phase (Task 7) is appropriately scoped: build + lint only, no runtime test (correct because there are no RPC handlers yet).
- Dependency chain between tasks is correctly stated (Task 3 → Task 4 → Task 5 → Task 6 → Task 7).
- Phase 1 / Phase 2 / Phase 3 split is logical and matches the commit plan.

PLAN_REVIEW_PASS
