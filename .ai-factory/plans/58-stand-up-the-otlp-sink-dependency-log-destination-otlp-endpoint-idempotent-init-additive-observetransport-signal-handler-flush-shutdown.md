# Plan: Stand up the OTLP sink — observe-js dependency, LOG_DESTINATION/OTLP_ENDPOINT, idempotent init, additive ObserveTransport, signal-handler flush/shutdown

## Context
Add an OTLP/Grafana log sink to `mind_api` by wiring the `observe-js` SDK into the existing Winston bootstrap logger — gated by real-env `LOG_DESTINATION`/`OTLP_ENDPOINT`, additive (file output stays byte-identical by default), with an idempotent graceful-shutdown handler that drains the SDK buffer. Closes DoD #1/#2/#4 of spec `.ai-factory/notes/45-observe-otlp-sink-swap.md`.

## Settings
- Testing: no
- Logging: minimal (ZERO new log lines — hard guard)
- Docs: yes (one env-contract page, Russian, per existing `docs/` convention)

## Tasks

### Phase 1: Dependency

- [x] **Task 1: Add `observe-js` git dependency and verify runtime + type resolution**
  Files: `package.json`
  Add `"observe-js": "git+https://github.com/mind-systems/observe-js.git#v0.1.0"` to `dependencies` (alongside the existing `winston` / `nest-winston` / `winston-daily-rotate-file` entries). Keep the existing ordering/style. The dual-build package resolves the CJS `require` entry `./dist/node.cjs` for NestJS and `./dist/winston.cjs` for the `observe-js/winston` subpath; `dist/` is built on install via tsup (the git tag ships source only — npm runs the package's `prepare`/`prepack` build script only for git/local installs, so Task 1 succeeds **only if** `observe-js@v0.1.0` ships such a script).

  **Before relying on the SDK**, verify two things against the installed `node_modules/observe-js/package.json`:
  1. The `exports` map declares a **`types`** condition for **both** `.` and `./winston` (not just `require`/`import`). `tsconfig.json` uses `module`/`moduleResolution: nodenext` with `resolvePackageJsonExports: true`; without `types` conditions, `import { ObserveTransport } from 'observe-js/winston'` fails to type-check (`Cannot find module … or its corresponding type declarations`). If `types` is absent, stop and report — the dep tag must be fixed upstream, not worked around here.
  2. `dist/` was actually built (the runtime smoke-check below catches a missing `prepare` script).

  After `npm install`, smoke-check **runtime** resolution:
  ```bash
  node -e "require('observe-js'); require('observe-js/winston'); console.log('ok')"
  ```
  The runtime smoke-check does **not** validate TypeScript type resolution. Because the `main.ts` imports are not added until Tasks 2–3, the definitive type check is `npm run build` (or `npx tsc --noEmit`) run **after** Task 3 — see Task 3's acceptance. Do not add any other dependency — the default exporter is `fetch`-based (Node 18+ global `fetch`, no extra dep).

### Phase 2: Bootstrap wiring (`src/main.ts`)

- [x] **Task 2: Resolve destination/endpoint env and build the transports array conditionally** (depends on Task 1)
  Files: `src/main.ts`
  At the top of `bootstrap()`, **before** `WinstonModule.createLogger(...)`, read directly from `process.env` (NOT via `ConfigModule` — `createLogger` runs before `.env` is parsed, same constraint as the existing `LOG_LEVEL`/`NODE_ENV` reads):
  - `logDestination = process.env.LOG_DESTINATION ?? 'file'` (∈ `file | grafana | both`)
  - `logToFile = logDestination === 'file' || logDestination === 'both'`
  - `logToGrafana = logDestination === 'grafana' || logDestination === 'both'`
  - `otlpEndpoint = process.env.OTLP_ENDPOINT ?? 'http://localhost:3100/otlp/v1/logs'`

  **Invalid-value safety:** an unrecognized `LOG_DESTINATION` (e.g. a typo like `none`) would leave both flags `false` and produce an empty transports array, which makes Winston warn *"Attempt to write logs with no transports."* Guard against this: if `logDestination` is none of the three accepted values, fall back to file output (treat it as `file`). Implement simply — e.g. derive `logToFile` as `logDestination !== 'grafana'` so any value except exactly `grafana` keeps file transports, while `grafana`/`both` still drive the Grafana flag. Keep the three documented values (`file`/`grafana`/`both`) as the supported contract.

  Replace the inline `transports: [...]` literal with a `const transports: winston.transport[] = []` that is populated conditionally. When `logToFile`, push the **existing** `Console` + two `DailyRotateFile` configs **verbatim** (move them behind `if (logToFile)` — do not change any of their options; with the default `file` destination the array must stay byte-identical to today). Pass `{ transports }` to `WinstonModule.createLogger`. Element type is `winston.transport` (confirmed valid: `node_modules/winston/index.d.ts` re-exports `transport = Transport`; `import * as winston` is already present). No call-site changes anywhere else.

- [x] **Task 3: Initialize the SDK and push `ObserveTransport` additively** (depends on Task 2)
  Files: `src/main.ts`
  Add imports `import { init, flush, shutdown } from 'observe-js';` and `import { ObserveTransport } from 'observe-js/winston';`. When `logToGrafana`, call `init({ project: 'mind', service: 'mind_api', endpoint: otlpEndpoint, onError: isProd ? undefined : (err) => console.error('[observe-js]', err) })` once (idempotent; emits the `service.start` restart marker), then `transports.push(new ObserveTransport())`. `init` must be called before `createLogger`. `onError` uses raw `console.error` (non-prod only) — never route it through the host logger (log loop). The transport maps Winston levels and strips Symbol-meta itself: write NO mapping code.
  **Acceptance (closes the Task 1 type-resolution check):** run `npm run build` (or `npx tsc --noEmit`) — it must compile clean with the new `observe-js` / `observe-js/winston` imports present. A failure here means the `types` export condition is missing (see Task 1).

- [x] **Task 4: Add idempotent SIGTERM/SIGINT graceful-shutdown handler** (depends on Task 3)
  Files: `src/main.ts`
  After `await app.listen(port)`, register a single handler shared by `SIGTERM` and `SIGINT`, guarded by one boolean (`shuttingDown`) so re-entrant signals no-op. **Error handling is mandatory:** today there is no signal handler, so a signal kills the process instantly (Node default); once a handler is registered, Node no longer auto-exits — the handler owns termination. If `app.close()`, `flush()`, or `shutdown()` rejects and the exit is not in a `finally`, the process hangs (and the `shuttingDown` guard makes a second Ctrl-C a no-op), a regression versus today's instant exit. Structure:
  ```ts
  let shuttingDown = false;
  const onSignal = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Watchdog: never let a hung close block termination forever.
    setTimeout(() => process.exit(1), 10_000).unref();
    try {
      await app.close();                                  // FIRST: drain in-flight requests; their logs are captured
      if (logToGrafana) {
        await flush();                                    // THEN: drain the SDK buffer (incl. close-time logs)
        await shutdown();
      }
    } catch (err) {
      if (!isProd) console.error('[shutdown]', err);      // non-prod only, raw console — never the host logger
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  ```
  Order matters: `app.close()` runs **first** (lets in-flight requests finish and have their logs captured), then `flush(); shutdown()` drains the SDK buffer including the graceful-close logs, then exit. The watchdog timeout (`.unref()` so it never holds the loop open) bounds a hung `app.close()`; 10s aligns with the prod `docker compose stop` default grace.
  Guards (do NOT do): do **not** call `app.enableShutdownHooks()` (global side effect); do **not** add an early `dotenv.config()` (would retroactively shift `LOG_LEVEL` resolution); do **not** rename or touch `src/realtime/services/observability.service.ts` (`ObservabilityService`, unrelated realtime-metrics logger).

  **Note — new execution path:** `app.close()` fires Nest lifecycle hooks that have **never run on a signal before** (no prior handler, no `enableShutdownHooks`). `stream-engine.service.ts` and `biometric-stream-engine.service.ts` implement `onApplicationShutdown()` (buffer flush → DB write); `sync-stream.service.ts` and `active-stream-registry.service.ts` implement `OnModuleDestroy`. This is beneficial (graceful buffer flush, and those close-time logs are exactly what `flush()` captures), but it interleaves engine DB-flush with TypeORM DataSource teardown inside the same `app.close()`. Covered by manual verification below — do not change those services.

### Phase 3: Documentation

- [x] **Task 5: Document the env contract and register the page** (depends on Task 4)
  Files: `docs/observability/log-destinations.md` (new), `CLAUDE.md`
  Write a short, behavior-focused page **in Russian** (matching the existing `docs/` convention — e.g. `docs/realtime/configuration.md`). Cover: the three `LOG_DESTINATION` modes (`file` / `grafana` / `both`, default `file`) and what each emits (and that any unrecognized value falls back to file output); `OTLP_ENDPOINT` (default `http://localhost:3100/otlp/v1/logs`); and the **real-env requirement** — both vars are read in `main.ts` before `ConfigModule` parses `.env`, so they must be set in the shell or Docker `env_file` (prod injects them via `env_file: .env.prod`), exactly like `LOG_LEVEL` / `NODE_ENV`. Note that `grafana`/`both` emit a `service.start` restart marker on boot and that file output is unchanged when the destination includes `file`. Then add a row for this page to the documentation table in `mind_api/CLAUDE.md` (the `### Documentation` table). Do not document methods/fields/code — describe behavior only.

## Verification (manual, from spec DoD #1/#2/#4)
- **Build:** `npm run build` compiles clean with the new imports (type-resolution gate from Tasks 1/3).
- **Default (`LOG_DESTINATION` unset → `file`):** console + log files unchanged; no OTLP traffic; `init`/transport never touched; no "no transports" Winston warning.
- **`LOG_DESTINATION=both OTLP_ENDPOINT=http://localhost:3100/otlp/v1/logs npm run start:dev`:** `service.start` marker on boot (`observe-logs since-restart mind_api --project mind`); existing log lines land in Loki tagged `project=mind`, `service_name=mind_api` (`observe-logs window … --project mind --service mind_api`).
- **Graceful stop (`SIGINT`):** the SDK buffer drains and close-time logs are present in Loki. **Also confirm the realtime engine flush-on-shutdown succeeds** — `onApplicationShutdown`/`OnModuleDestroy` hooks run for the first time on a signal, so check there is no "connection closed" / DataSource-destroyed error from hook-vs-TypeORM teardown ordering, and that buffered samples are persisted. A second Ctrl-C / SIGTERM during shutdown must not wedge the process (watchdog bounds it to ~10s).
- **Signal delivery note:** dev (`nest start --watch`) forwards Ctrl-C less reliably than prod; the authoritative path is prod, where the `Dockerfile` CMD `["dumb-init", "node", "dist/main"]` forwards SIGTERM/SIGINT to Node as PID 1 under `docker compose stop` (10s grace). Prefer verifying the signal path against the prod/container path.
