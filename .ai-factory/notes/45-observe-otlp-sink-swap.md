# Observability logging — OTLP sink swap (`observe-js`, Phase 34)

**Date:** 2026-06-18
**Source:** `~/projects/observability/.ai-factory/notes/02-integrate-mind-api.md` + codebase recon + owner confirmation

## Key Findings

- **Single sink, verified.** Every server log funnels through the inline `WinstonModule.createLogger()` in `src/main.ts` (console + `error-%DATE%.log` + `combined-%DATE%.log` via `winston-daily-rotate-file`). All services use `new Logger(X.name)` from `@nestjs/common`, which `NestFactory.create(AppModule, { logger })` routes into that one Winston instance. The **only** non-Winston path is `src/scripts/seed-breath-sessions.ts` (`console.log/error`) — a standalone CLI seed script, not part of the running server process, **out of scope**.
- **Bootstrap ordering.** `createLogger()` runs **before** `NestFactory.create()`, i.e. before `ConfigModule.forRoot({ envFilePath: '.env' })` parses `.env`. So at that moment `process.env` carries only OS/Docker-injected vars — exactly how the existing `process.env.LOG_LEVEL` / `process.env.NODE_ENV` reads already work. New vars must therefore be **real env (shell / Docker `env_file`), not `.env`**. Adding an early `dotenv.config()` is rejected — it would retroactively change `LOG_LEVEL` resolution for local dev (a side effect, out of scope).
- **Shutdown hooks are OFF.** `app.enableShutdownHooks()` is never called. Enabling it is a global flag flip (would switch on every module's shutdown hooks). Rejected in favor of a localized, idempotent `SIGTERM`/`SIGINT` handler in `main.ts`.
- **API surface (confirmed against the `v0.1.0` source tree):**
  - Default entry (`observe-js`): `init(opts: InitOptions): void` — synchronous, idempotent (second call no-ops, reports via `onError`), emits the `service.start` restart marker. `flush(): Promise<void>`, `shutdown(): Promise<void>`.
  - `InitOptions = { project: string; service: string; endpoint: string; batch?; onError?: (err) => void; exporter? }`. With no `exporter`, a default `fetch`-based OTLP exporter is built internally (Node 18+ global `fetch` — no extra dep).
  - Winston subpath (`observe-js/winston`): `class ObserveTransport extends Transport`; constructor takes optional `Transport.TransportStreamOptions`. It maps Winston levels → canonical tokens (`http`/`verbose`/`debug`→`debug`, `silly`→`trace`, rest 1:1), strips `Symbol`-keyed meta, and **never throws** into the host logger. No mapping code to write.
  - `onError` must **not** be routed through the host logger (log loop). Use raw `console.error`, and only in non-prod.
- **Dual build.** `package.json` `exports` resolves `require` → `./dist/node.cjs` for NestJS (CommonJS) and `./winston` → `./dist/winston.cjs`. `dist/` is built on install (tsup); the git tag ships source only.

## Implementation

All changes are in **`package.json`** + **`src/main.ts`** + one **`docs/`** page. Zero call-site changes, zero new log lines.

### 1. Dependency (`package.json`)

```jsonc
"dependencies": {
  // ...
  "observe-js": "git+https://github.com/mind-systems/observe-js.git#v0.1.0",
  // winston / nest-winston / winston-daily-rotate-file already present
}
```

`npm install`, then smoke-check resolution:
```bash
node -e "require('observe-js'); require('observe-js/winston'); console.log('ok')"
```

### 2. `src/main.ts`

Resolve the destination + endpoint at the top of `bootstrap()` (before `createLogger`), gate the SDK on `grafana`, push the transport additively, register the shutdown handler.

```ts
import { init, flush, shutdown } from 'observe-js';
import { ObserveTransport } from 'observe-js/winston';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  // Real env only — createLogger runs before ConfigModule parses .env.
  const logDestination = process.env.LOG_DESTINATION ?? 'file'; // file | grafana | both
  const logToFile = logDestination === 'file' || logDestination === 'both';
  const logToGrafana = logDestination === 'grafana' || logDestination === 'both';
  const otlpEndpoint =
    process.env.OTLP_ENDPOINT ?? 'http://localhost:3100/otlp/v1/logs';

  if (logToGrafana) {
    init({
      project: 'mind',
      service: 'mind_api',
      endpoint: otlpEndpoint,
      onError: isProd ? undefined : (err) => console.error('[observe-js]', err),
    });
  }

  const transports: winston.transport[] = [];
  if (logToFile) {
    transports.push(
      new winston.transports.Console({ /* unchanged */ }),
      new DailyRotateFile({ /* error-%DATE%.log, unchanged */ }),
      new DailyRotateFile({ /* combined-%DATE%.log, unchanged */ }),
    );
  }
  if (logToGrafana) {
    transports.push(new ObserveTransport());
  }

  const logger = WinstonModule.createLogger({ transports });

  const app = await NestFactory.create(AppModule, { logger });
  // ... helmet, pipes, cors, microservice, listen — unchanged ...

  // Idempotent graceful shutdown: close the app FIRST so in-flight requests
  // finish and their logs are captured, THEN drain the SDK buffer.
  let shuttingDown = false;
  const onSignal = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
    if (logToGrafana) {
      await flush();
      await shutdown();
    }
    process.exit(0);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
```

Notes:
- Keep the existing Console + two `DailyRotateFile` configs **verbatim** — only move them behind `if (logToFile)`. With the default `LOG_DESTINATION=file`, the array is byte-identical to today and `init`/transport are never touched (zero risk).
- `winston.transport` is the element type (`import * as winston` already present).
- `init` is idempotent, so guarding on `logToGrafana` is for clarity, not correctness.

### 3. Env documentation (`docs/`)

Per the workspace convention (`~/projects/observability/docs/log-destinations.md`) and existing `docs/` style (Russian, behavior-focused). Add a short page describing: the three `LOG_DESTINATION` modes (`file`/`grafana`/`both`, default `file`), `OTLP_ENDPOINT` (default local backend), and the **real-env requirement** — both vars are read in `main.ts` before `ConfigModule` parses `.env`, so they must be set in the shell or Docker `env_file`, exactly like `LOG_LEVEL`/`NODE_ENV`. Register it in `CLAUDE.md`'s docs table.

## Verification (DoD #1/#2/#4)

- Default (`LOG_DESTINATION` unset → `file`): logs/console + files unchanged; no OTLP traffic.
- `LOG_DESTINATION=both OTLP_ENDPOINT=http://localhost:3100/otlp/v1/logs npm run start:dev`:
  - `service.start` marker appears on boot — `observe-logs since-restart mind_api --project mind`.
  - existing log lines land in Loki tagged `project=mind`, `service_name=mind_api` — `observe-logs window … --project mind --service mind_api`.
- Graceful stop (`SIGINT`): the buffer drains; the close-time logs are present in Loki.

## Guards

- ZERO new log lines; NO call-site changes.
- Do NOT enable `app.enableShutdownHooks()`.
- Do NOT add an early `dotenv.config()`.
- Do NOT rename or touch `src/realtime/services/observability.service.ts` (`ObservabilityService` — unrelated 60s realtime-metrics logger).
- `onError` → raw `console.error`, non-prod only (never the host logger).
