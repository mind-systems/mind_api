# Code Review: Stand up the OTLP sink (`observe-js`, Phase 34)

**Plan:** `.ai-factory/plans/58-stand-up-the-otlp-sink-…-flush-shutdown.md`
**Changed code files:** `package.json`, `package-lock.json`, `src/main.ts`, `docs/observability/log-destinations.md`, `CLAUDE.md`
**Verification run:** `npm run build` (clean), runtime `require` smoke-check (ok), `npm ls winston-transport` (deduped single copy).

---

## Summary

The implementation matches the (post-review) plan exactly. The change is confined to the bootstrap layer plus one dependency and one docs page. No call-site changes, no new log lines, no `enableShutdownHooks()`, no early `dotenv.config()`, `ObservabilityService` untouched. Build compiles clean with the new imports. No correctness, security, or runtime-breaking defects found.

---

## What was verified

### Dependency resolution (Task 1) — ✅
- `observe-js` pinned to the git tag in `package.json` dependencies; `package-lock.json` records the resolved commit `a42a85c…` for `#v0.1.0`.
- Installed `node_modules/observe-js/package.json` `exports` declares **`types`** conditions for **both** `.` and `./winston` (under `node`/`import`/`require`) — the `nodenext` type-resolution risk flagged in plan-review #1 (#3) is resolved. `typesVersions` also maps `winston`.
- A `prepare` script (`npm run build` → tsup) is present and `dist/` is fully built (`node.cjs`, `winston.cjs`, and all `.d.cts`/`.d.ts` present). The git-tag-ships-source-only concern is satisfied.
- Runtime smoke-check passes: `require('observe-js')` and `require('observe-js/winston')` both load.
- **Peer-dependency hazard checked:** `winston-transport@4.9.0` is **deduped** to a single copy shared by `observe-js`, `winston`, and `winston-daily-rotate-file`. No dual-instance problem — Winston's internal `instanceof` transport check will accept `ObserveTransport`.

### Bootstrap wiring (`src/main.ts`, Tasks 2–4) — ✅
- Env reads use `process.env` directly, before `createLogger` — consistent with the existing `LOG_LEVEL`/`NODE_ENV` reads (correct, since this runs before `ConfigModule` parses `.env`).
- **Invalid-value safety implemented correctly:** `logToFile = logDestination !== 'grafana'` means `file`/`both`/any-typo → file transports on; only exact `grafana` disables them. `logToGrafana = … 'grafana' || … 'both'`. No path yields an empty `transports[]`, so the "no transports" Winston warning cannot occur.
- The three existing transports (Console + two `DailyRotateFile`) are reproduced **verbatim** behind `if (logToFile)`. With the default `file` destination the array is byte-identical to before — zero behavioral change by default, and `init`/`ObserveTransport` are never touched.
- `init(...)` is called once, before `createLogger`, gated on `logToGrafana`; `ObserveTransport` is pushed additively. `onError` uses raw `console.error`, non-prod only — no host-logger log loop, and `undefined` in prod. No level-mapping code written (correct — the transport handles it).
- Signal handler matches the hardened shape: single `shuttingDown` boolean guard, `.unref()`'d 10s watchdog (`process.exit(1)`), `app.close()` first, then `flush()`/`shutdown()` only when `logToGrafana`, all wrapped in `try/catch/finally` with `process.exit(0)` in `finally`. The wedge regression from plan-review #1 (#1) is resolved — a throwing `app.close()`/`flush()` cannot hang the process.

### Docs (Task 5) — ✅
- `docs/observability/log-destinations.md` is in Russian, behavior-focused, matches `docs/realtime/configuration.md` style. Correctly documents the three modes, the typo→file fallback, `OTLP_ENDPOINT`, the real-env requirement, and prod `env_file: .env.prod` injection. No method/field dumps.
- `CLAUDE.md` documentation table has the `Log Destinations` row registered.

---

## Non-blocking observations (no change required)

1. **New shutdown-hook execution path (manual-verify item, already in the plan).** `app.close()` in the new handler fires the realtime lifecycle hooks (`onApplicationShutdown` in `stream-engine`/`biometric-stream-engine`, `OnModuleDestroy` in `sync-stream`/`active-stream-registry`) on a signal for the first time — previously a signal killed the process instantly. This is the intended graceful-flush behavior, and any throw is caught (non-prod logs, prod swallows) so it cannot hang. Worth confirming under a real `SIGINT`/container `stop` that engine buffer-flush to the DB completes before TypeORM tears the DataSource down (no "connection closed" error). This is already listed in the plan's Verification section; flagging only so it isn't skipped.

2. **Exit code is always `0` on the graceful path, even if `app.close()`/`flush()` threw** (the `finally` uses `exit(0)`; only the watchdog uses `exit(1)`). This is a deliberate "we attempted graceful shutdown" choice and is fine for SIGTERM/SIGINT semantics. Noted for awareness, not a defect.

3. **`package.json` ordering nit:** `observe-js` was inserted between `typeorm` and `winston` rather than alphabetically. The repo's dependency list isn't strictly alphabetized, so this is cosmetic only.

4. **Pre-existing, unrelated:** `npx tsc --noEmit` surfaces type errors in `src/realtime/services/biometric-stream-engine.service.spec.ts` (a `Partial<BioSessionSample>` cast). These exist independently of this change and do not affect `nest build` (which excludes specs and compiles clean). Out of scope for this milestone.

---

REVIEW_PASS
