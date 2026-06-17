# Plan Review: Stand up the OTLP sink (`observe-js`, Phase 34)

**Plan:** `.ai-factory/plans/58-stand-up-the-otlp-sink-…-flush-shutdown.md`
**Spec note:** `.ai-factory/notes/45-observe-otlp-sink-swap.md`
**Files reviewed:** plan, spec note, `src/main.ts`, `package.json`, `tsconfig.json`, `Dockerfile`, `docker-compose.prod.yml`, `Makefile`, realtime lifecycle services, context-gate docs.
**Risk Level:** 🟡 Medium — implementable as written, but two non-trivial gaps (signal-handler error handling, subpath type resolution) should be resolved before implementation.

---

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** ✅ PASS. The change is confined to the bootstrap layer (`src/main.ts`) + `package.json` + one docs page. No module boundaries crossed, no cross-module repository access, no new entity. The "client IP / trust proxy" invariant (§7) is untouched. The explicit guard against `app.enableShutdownHooks()` is consistent with the localized-handler approach.
- **Rules (`RULES.md`):** ✅ PASS. No non-null assertions introduced. "Keep logs lean" / "zero new log lines" is an explicit hard guard. `onError` routes to raw `console.error` (non-prod only), never the host logger — no log loop, no PII (SDK transport errors only). One minor note: `console.error('[observe-js]', err)` could surface the OTLP endpoint URL — not PII, acceptable.
- **Roadmap (`ROADMAP.md`):** ✅ PASS. This is Phase 34 line 193, and the milestone text is the source of this plan. Linkage is explicit. (`feat`/observability work is correctly anchored.)

---

## Critical Issues

None that block implementation. The plan is internally consistent with the codebase and the spec note. The items below are should-fix correctness/robustness gaps and assumptions to verify.

---

## Should-Fix Issues

### 1. Signal handler has no error handling — can wedge the process (behavioral regression)
Tasks 4 specifies:
```
if (shuttingDown) return; shuttingDown = true;
await app.close();
if (logToGrafana) { await flush(); await shutdown(); }
process.exit(0);
```
Today there is **no** `SIGINT`/`SIGTERM` handler, so a signal kills the process immediately (Node default). Once you register a handler, Node no longer auto-exits on that signal — the handler owns termination. If `app.close()`, `flush()`, or `shutdown()` **throws/rejects**, control never reaches `process.exit(0)`, and the `shuttingDown` guard makes a *second* Ctrl-C / SIGTERM a no-op. Result: the process hangs until SIGKILL — a regression versus today's instant exit.

**Recommendation:** put the exit in a `finally`, and harden against a hung close:
```ts
const onSignal = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.close();
    if (logToGrafana) { await flush(); await shutdown(); }
  } catch (err) {
    if (!isProd) console.error('[shutdown]', err);
  } finally {
    process.exit(0);
  }
};
```
Optionally add a watchdog timer (`setTimeout(() => process.exit(1), N).unref()`) so a hung `app.close()` cannot block forever. The spec note (lines 83–95) shows the same no-try/catch shape — the gap originates there, not just in the plan.

### 2. `app.close()` will fire realtime shutdown hooks for the first time on a signal — untested new path
`src/realtime/services/stream-engine.service.ts` and `biometric-stream-engine.service.ts` implement `onApplicationShutdown()` (buffer flush → DB write); `sync-stream.service.ts` and `active-stream-registry.service.ts` implement `OnModuleDestroy`. These hooks run on `app.close()`. Because today neither `enableShutdownHooks()` nor any signal handler exists, **these flush hooks have never executed on SIGTERM/SIGINT** — buffers are currently lost on shutdown.

Introducing `await app.close()` in the handler activates all of them for the first time on a signal. This is almost certainly *beneficial* (graceful buffer flush), and the close-time logs it produces are exactly what the OTLP `flush()` is meant to capture. But it is a new execution path the plan does not call out, and it interleaves engine DB-flush with TypeORM DataSource teardown during the same `app.close()`. **Add to manual verification:** confirm the engine flush-on-shutdown succeeds (no "connection closed"/DataSource-destroyed error from hook ordering) under a real `SIGINT`. This belongs in the Verification section alongside the Loki checks.

### 3. Subpath type resolution under `nodenext` depends on `observe-js` exports `types` conditions
`tsconfig.json` uses `module/moduleResolution: nodenext` with `resolvePackageJsonExports: true`. Under this resolver, `import { ObserveTransport } from 'observe-js/winston'` and `import { init, flush, shutdown } from 'observe-js'` will only type-check if `observe-js`'s `package.json` `exports` map declares **`types` conditions** for both `.` and `./winston` (not just `require`). The spec note (line 16) documents the `require` → `./dist/node.cjs` / `./winston` → `./dist/winston.cjs` conditions but says nothing about `types`. If they are absent, the build fails with *"Cannot find module 'observe-js/winston' or its corresponding type declarations."*

**Recommendation:** before/at Task 1, verify `observe-js@v0.1.0` `exports` includes `types` for both entries. The plan's runtime smoke-check (`node -e "require(...)"`) validates *runtime* resolution but **not** TypeScript type resolution — add a `npm run build` (or `tsc --noEmit`) check to Task 1's acceptance so a missing `types` condition is caught in this milestone, not at `start:prod`.

---

## Minor / Nits

- **Invalid `LOG_DESTINATION` value → empty transports array.** Tasks 2/3 only populate transports for `file`/`grafana`/`both`. A typo such as `LOG_DESTINATION=none` yields `transports: []`, and Winston warns *"Attempt to write logs with no transports."* Consider validating the value and falling back to `file` (or at least documenting the three accepted values as the only safe inputs — Task 5 already documents the three modes, which mitigates this).
- **Task 1 dist build assumption.** The plan states `dist/` is "built on install via tsup" from the git tag. This requires `observe-js` to define a `prepare` (or `prepack`) build script — npm only runs `prepare` for git/local installs. If absent, `dist/` won't exist and the smoke-check fails. The smoke-check does catch it, so this is low-risk, but worth being explicit that Task 1 succeeds *only if* `observe-js` ships a `prepare` script.
- **Dev signal delivery.** Verification step 3 uses `npm run start:dev` (→ `nest start --watch`). Signal forwarding through the watch wrapper is less reliable than the prod path. Prod is correct: `Dockerfile` CMD is `["dumb-init", "node", "dist/main"]`, and `dumb-init` forwards SIGTERM/SIGINT to Node as PID 1 — so the handler fires under `docker compose stop` (default 10s grace). No change needed; just be aware a dev Ctrl-C may behave slightly differently from prod.

---

## Verified / Correct Assumptions

- `winston.transport` is a valid type (`node_modules/winston/index.d.ts:20` — `export import transport = Transport`). The `const transports: winston.transport[] = []` annotation in Task 2 compiles.
- `import * as winston` and `DailyRotateFile = require('winston-daily-rotate-file')` are already present in `main.ts`; moving the three transports behind `if (logToFile)` is purely a re-arrangement — byte-identical default behavior is achievable.
- `createLogger()` genuinely runs before `ConfigModule` parses `.env` (confirmed in `main.ts` — `createLogger` at line 17, `NestFactory.create` at 50). Reading `LOG_DESTINATION`/`OTLP_ENDPOINT` from `process.env` is the right pattern and mirrors the existing `LOG_LEVEL`/`NODE_ENV` reads.
- No existing `process.on('SIGTERM'|'SIGINT')`, `enableShutdownHooks`, or `LOG_DESTINATION`/`OTLP`/`observe-js` usage anywhere in `src/` — no conflict.
- `app.close()` (not `enableShutdownHooks`) correctly triggers Nest lifecycle hooks; the deliberate avoidance of `enableShutdownHooks()` is sound.
- Prod env injection: `docker-compose.prod.yml` uses `env_file: .env.prod`, so `LOG_DESTINATION`/`OTLP_ENDPOINT` set there are real container env — satisfies the documented requirement.
- Docs path: `docs/` exists with no `observability/` subdir; creating `docs/observability/log-destinations.md` is consistent. Russian-language docs match the existing convention (per project memory and existing `docs/realtime/configuration.md`).

---

## Positive Notes

- Excellent risk framing: default `LOG_DESTINATION=file` keeps today's behavior byte-identical, and the SDK is never touched — genuinely zero-risk by default.
- Clear, explicit anti-goals (no `dotenv.config()`, no `enableShutdownHooks()`, no touching `ObservabilityService`, no mapping code) prevent foreseeable mistakes.
- Correct shutdown ordering rationale: `app.close()` *before* `flush()/shutdown()` so in-flight/close-time logs are captured before the buffer drains.
- Task dependencies (1→2→3→4→5) are correctly ordered and each task scopes its files precisely.
- Documentation task correctly localizes (Russian) and registers the page in the `CLAUDE.md` docs table.

---

## Verdict

The plan is well-researched and architecturally sound, but I cannot pass it clean: the signal-handler error-handling gap (#1) is a real shutdown-reliability regression, and the `nodenext` type-resolution assumption (#3) can fail the build at the very end of the milestone. Address #1 and #3 (and add #2 to manual verification) before implementation.
