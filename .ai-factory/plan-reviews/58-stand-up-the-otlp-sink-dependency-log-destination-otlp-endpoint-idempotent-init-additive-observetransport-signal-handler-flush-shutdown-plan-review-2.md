# Plan Review #2: Stand up the OTLP sink (`observe-js`, Phase 34)

**Plan:** `.ai-factory/plans/58-stand-up-the-otlp-sink-…-flush-shutdown.md`
**Spec note:** `.ai-factory/notes/45-observe-otlp-sink-swap.md`
**Files reviewed:** plan, spec note, `src/main.ts`, `package.json`, `tsconfig.json`, `Dockerfile`, realtime lifecycle services, `docs/` layout.
**Risk Level:** 🟢 Low — all three should-fix items and the three nits from review #1 are now resolved in the plan text. Implementable as written.

---

## Context Gates

- **Architecture:** ✅ PASS. Change confined to the bootstrap layer (`src/main.ts`) + `package.json` + one docs page. No module boundaries crossed, no entity, no migration. The explicit anti-goal against `app.enableShutdownHooks()` keeps the change localized.
- **Rules:** ✅ PASS. "Zero new log lines" is an explicit hard guard. `onError` / `[shutdown]` errors route to raw `console.error` non-prod only — no log loop, no host-logger PII path. No non-null assertions introduced.
- **Roadmap:** ✅ PASS. Phase 34, milestone is the source of this plan; linkage explicit.

---

## Resolution of Review #1 findings

All items from the first review are addressed in the current plan text:

1. **Signal-handler error handling (was the blocking issue).** Task 4 now specifies the full `try { … } catch { non-prod console.error } finally { process.exit(0) }` shape plus a `setTimeout(() => process.exit(1), 10_000).unref()` watchdog, with an explicit rationale paragraph on why the bare-await form would wedge the process. ✅ Resolved.
2. **New `app.close()` lifecycle path.** Task 4's "Note — new execution path" calls out that `onApplicationShutdown()` (`stream-engine`, `biometric-stream-engine`) and `OnModuleDestroy` (`sync-stream`, `active-stream-registry`) hooks fire on a signal for the first time, and the Verification section now requires confirming the engine flush succeeds with no DataSource-teardown ordering error. ✅ Resolved.
3. **Subpath type resolution under `nodenext`.** Task 1 now explicitly requires verifying a `types` condition for both `.` and `./winston` in the installed `exports` map, states the failure mode, and Task 3's acceptance adds the `npm run build` / `tsc --noEmit` gate as the definitive type check. ✅ Resolved.
4. **Invalid `LOG_DESTINATION` → empty transports.** Task 2 now adds the fallback-to-file guard (`logToFile = logDestination !== 'grafana'`) so any unrecognized value keeps file output and avoids Winston's "no transports" warning. ✅ Resolved.
5. **`dist/` build-on-install assumption.** Task 1 now states the dependency succeeds only if `observe-js@v0.1.0` ships a `prepare`/`prepack` build script, and the runtime smoke-check catches its absence. ✅ Resolved.
6. **Dev signal-delivery caveat.** Verification's "Signal delivery note" now states prod (`dumb-init` PID 1) is the authoritative path and dev Ctrl-C is less reliable. ✅ Resolved.

---

## Verified codebase assumptions

- `winston.transport` is a valid type alias — `node_modules/winston/index.d.ts:20` (`export import transport = Transport`). The `const transports: winston.transport[] = []` annotation compiles.
- `import * as winston` and `DailyRotateFile = require('winston-daily-rotate-file')` already present in `main.ts`; the three transports moving behind `if (logToFile)` is a pure re-arrangement → byte-identical default behavior.
- `createLogger()` (line 17) runs before `NestFactory.create` (line 50), confirming the `process.env`-direct read for `LOG_DESTINATION`/`OTLP_ENDPOINT` mirrors the existing `LOG_LEVEL`/`NODE_ENV` pattern.
- `tsconfig.json`: `module`/`moduleResolution: nodenext`, `resolvePackageJsonExports: true` — confirms the `types`-condition concern in Task 1 is real and correctly flagged.
- Realtime shutdown hooks confirmed: `onApplicationShutdown()` in `stream-engine.service.ts:76` and `biometric-stream-engine.service.ts:70`; `OnModuleDestroy` in `sync-stream.service.ts:26` and `active-stream-registry.service.ts:5`. Task 4's note is accurate.
- No existing `SIGTERM`/`SIGINT` handler, `enableShutdownHooks`, or `observe-js`/`LOG_DESTINATION`/`OTLP` usage in `src/` — no conflict.
- `Dockerfile:40` CMD `["dumb-init", "node", "dist/main"]` — confirms the prod signal-forwarding path the verification relies on.
- `docs/` has subdirs (`auth`, `breath`, `realtime`, `stats`, `sync`) and no `observability/` — creating `docs/observability/log-destinations.md` is consistent.
- `observe-js` not yet installed — correctly the deliverable of Task 1.

---

## Minor / Nits (non-blocking)

- Task 2 carries both the conceptual definition (`logToFile = logDestination === 'file' || logDestination === 'both'`) and the safety form (`logToFile = logDestination !== 'grafana'`). These differ only for invalid input, and the text explicitly directs the implementer to the `!== 'grafana'` form. No action needed — just don't ship both lines.
- The 10s watchdog matching the `docker compose stop` default grace is sound; if prod ever sets a longer `stop_grace_period`, revisit so the watchdog stays ≥ the SDK flush budget. Out of scope for this milestone.

---

## Positive Notes

- Default `LOG_DESTINATION=file` keeps today's behavior byte-identical and never touches the SDK — genuinely zero-risk by default.
- Clear, explicit anti-goals (no `dotenv.config()`, no `enableShutdownHooks()`, no touching `ObservabilityService`, no mapping code) prevent the foreseeable mistakes.
- Shutdown ordering rationale is correct: `app.close()` before `flush()/shutdown()` so in-flight and close-time logs are captured before the buffer drains.
- Task dependencies (1→2→3→4→5) ordered correctly with precise file scoping; the type-resolution gate is now wired into Task 3's acceptance rather than left implicit.

---

## Verdict

Every issue raised in review #1 is resolved in the plan text, and all codebase assumptions check out against the current tree. The plan is well-scoped, internally consistent, and ready to implement.

PLAN_REVIEW_PASS
