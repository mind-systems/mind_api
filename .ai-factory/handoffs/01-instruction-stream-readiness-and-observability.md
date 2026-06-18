# Handoff — instruction-stream readiness race + observability enablement

## 1. Frame
Observability logging now works end-to-end (mind_mobile + mind_api both ship to local Loki, correlatable by `trace_id`); the next real work is verifying and fixing the gRPC instruction-stream cold-start race (note 44). The chat is compacted but the knowledge is durable in the files below — rehydrate from them, don't trust memory.

## 2. Read-first map

### Must-read now (minimal rehydration set)
- `mind_api/.ai-factory/notes/44-instruction-stream-readiness-race.md` — THE spec: the server-side race, the two-part decision (eager-open + ACK), the A/B/C fork, and the verification plan that gates everything. Start here.
- `mind_mobile/docs/realtime/live-session-tracking.md` — abstract, target-state data-flow doc (control plane vs data plane, "Готовность туннеля", single-session model). Russian, class-name-free by design.
- `mind_mobile/docs/realtime/data-flow.mmd` — the block diagram of all three tunnels from Play.

### Read on demand
- `mind_mobile/.ai-factory/notes/101-probe-ack-instruction-stream-readiness.md` — the probe/ACK mechanism + the decision update (cold-start handled by eager-open; probe/ACK is for the reconnect path).
- `mind_api/src/realtime/module-instruction-stream.grpc.controller.ts` + `module-biometric-stream.grpc.controller.ts` — the two data controllers; both call `request.subscribe()` inside the post-auth Observable (the race site).
- `observability/observe-js/.ai-factory/notes/14-winston-subpath-shared-core-singleton.md` — why mind_api logs reach Loki now (winston transport fix).
- `mind_api/.ai-factory/ROADMAP.md` Phases 34/35/36 — the observability logging integration history.

## 3. Current state

**Done:**
- Observability end-to-end live in Loki: `service_name=mind_mobile` and `service_name=mind_api` under `project=mind`. Verified with a real breath session (mind_api stream: `[ActivityEngine] Session started…`, `Flushed N samples…`, not just `service.start`).
- mind_api Phase 36 **committed** (`dev` @ `20720b3`): `import 'dotenv/config'` preload in `src/main.ts` + `observe-js` `#v0.1.0`→`#main` (resolved `6dea814f`).
- Decision on the race recorded (note 44): eager-open all data tunnels at connect (mobile) **+** readiness ACK for the reconnect path (both sides); verification-first.
- Tasks filed across the family: `observe-js` note 14 + roadmap task (winston fix — DONE by their team on main), `observe-dart` note 13 + roadmap task (charset fix — DONE on main), `mind_mobile` roadmap readiness task + note 101, `mind_mobile` note 104 (instruction timestamp = event-time, separate bug).

**In-flight / not started:**
- The note-44 **verification** has NOT run yet. No debug logs on the data controllers, so a `trace_id` query in Loki shows no `next`/`subscribe` ordering event.
- The race **fix** is not implemented (gated on verification).

**Uncommitted working-tree state:**
- mind_api: **clean** (Phase 36 committed). `.env` carries `LOG_DESTINATION=both` + `OTLP_ENDPOINT` but is **gitignored** — intentional, local only; do not commit secrets.
- Out of this agent's scope but present: `mind_mobile` (docs rewrite, pubspec→observe `main`, roadmap/notes) and `observability/*` (roadmap/notes) have uncommitted edits — not the API agent's concern.

## 4. Next step
Run the note-44 verification (≈15 min, the gate for the whole fix):
1. Add two debug log lines to **both** `module-instruction-stream.grpc.controller.ts` and `module-biometric-stream.grpc.controller.ts`: one at the very top of the `next` handler (log `sessionId`, `instructionType`), and one at the moment `request.subscribe()` is called — so the ordering "frame received vs subscribed" is visible.
2. With mind_api on `LOG_DESTINATION=both`, drive one cold breath session from the phone.
3. `observe-logs trace <id>` (or `window --service mind_api`) and read whether the first frame reaches `next` **before or after** subscribe. That resolves the A/B/C fork in note 44: if early frames are genuinely dropped → server-side buffering (Option B) is the floor; otherwise eager-open + ACK (the chosen path) is sound.
Only after this, implement the server side (a `STREAM_READY` handler as the **first** check in `next`, before the `!msg.sessionId` guard, on both controllers) — deploy server before mobile.

## 5. Working discipline
- **Commit only on explicit permission.** This session: the user explicitly authorized the Phase 36 commit; nothing else was committed.
- **Route fixes to the owning project**, not direct edits to someone else's repo: SDK bugs became tasks+specs in `observe-js`/`observe-dart` roadmaps ("пусть сами разбираются со своим кодом"). Two-tier always: a contract line in the roadmap + a self-contained spec note.
- **Verification before building** — the user insisted the logs run before any race fix; do not implement a fourth attempt on theory.
- Docs: describe **target state**, present tense, **no history language**, and **abstract — no class names** (so docs survive refactors). Match neighboring doc language (mind docs are Russian; notes/roadmaps/handoffs are English).
- Commit messages: sentence case, no trailing period, no `feat:`/`fix:` prefixes; body only for multi-change commits; end with the `Co-Authored-By: Claude Opus 4.8` trailer.

## 6. Error log
- **OTLP 400 misdiagnoses (mind_mobile→Loki):** first suspected `timeUnixNano` as a JSON number, then `traceId`/`spanId` hex length, then the `eventName` field — all ruled out by curl repro (number AND string timestamps both returned 204). **Actual cause:** `package:http` appends `; charset=utf-8` to the Content-Type for **String** bodies; Loki's OTLP endpoint rejects any charset suffix. **Fix:** send the body as UTF-8 **bytes** (`utf8.encode(...)`) — landed on `observe-dart` main.
- **mind_api logs absent from Loki — two layered causes:** (1) `LOG_DESTINATION` was unset → defaulted to `file`, so the OTLP transport never attached (only `service.start`, emitted directly by `init()`, shipped). (2) After enabling it, still only `service.start` shipped because `observe-js`'s `ObserveTransport` bundled a **duplicate, never-initialized core singleton** (`dist/winston.cjs` had a tree-shaken `log(){ return; }`); `init()` populated node.cjs's core, the transport read winston.cjs's. Fixed on `observe-js` main (winston entry now `require('observe-js')`).
- **Guard reversal:** the dotenv preload added in `src/main.ts` **intentionally reverses** Phase 34's documented guard "do not add an early `dotenv.config()`". Consequence: `LOG_LEVEL`/`NODE_ENV` now also resolve from `.env` at bootstrap (dotenv does not override values already set in the real shell env). Recorded in Phase 36; re-verify if startup log level/NODE_ENV behaves unexpectedly.
- **npm git-dep cache:** changing `package.json` `#v0.1.0`→`#main` + plain `npm install` said "up to date" (lock still pinned the old commit). Had to `npm install "git+…observe-js.git#main"` to force re-resolve to `6dea814f`.

## 7. Orientation (confusable pairs)
- **`service.start` vs regular logs:** `service.start` is emitted by `init()` directly through the SDK core — it shipping proves the SDK pipeline works but says **nothing** about whether the Winston→SDK transport works. Don't treat its presence as "logging works."
- **The race (delivery) vs the timestamp shift (mind_mobile note 104):** two different bugs in the same start sequence. The race = first sample may be dropped before subscribe. Task 104 = the first phase is stamped at *send* time (after the round-trip), not at the phase transition, so phases trail biometrics by ~1.5s. Do not conflate; 104 is mobile-only and deferred.
- **Loki `service_name`:** `mind_api`/`mind_mobile` (underscore) are the real services; `mind-mobile`/`manual`/`curl-test`/`diag` are leftover test noise from this session's probes.

## 8. Domain model spine (do not re-litigate)
- **One active module-session per user.** Server `ActivityEngine`/`ActivitySessionStore` is keyed by `userId` → a single `ActivityState`; mobile blocks a second `start` while active. Concurrent modules are NOT supported by the session model — the transport is multi-session-capable (every sample carries its `sessionId`), so enabling concurrency is a session-model change, not a transport one. (`mind_api/src/realtime/services/activity-engine.service.ts`, `mind_mobile/docs/realtime/live-session-tracking.md`.)
- **Three tunnels, one connection.** Control/state stream opens **eagerly** on connect (so it never races); instruction + biometric data tunnels open **lazily** on first sample today — the target state is eager-open for them too. All correlate via `moduleSessionId`.

## 9. Hard rules
- Never commit without explicit permission; `.env` is gitignored — never commit it.
- `package-lock.json` is committed **with** `package.json` (pins the floating `#main` to an exact commit — reproducible installs).
- Proto contract source of truth is `mind_api/proto/`; consumers copy + regen. (Not touched this session.)

## 10. Per-repo state map
- **mind_api** — Phase 36 committed (`20720b3` on `dev`). Logging to Loki works. Next: note-44 verification (section 4).
- **mind_mobile** — on `observe` git `main` (charset fix consumed); docs rewritten to abstract target state; roadmap has the readiness task + note 104 (timestamp). Uncommitted.
- **observability/observe-js** — winston fix on main (singleton shared via self-import); note 14 + roadmap task.
- **observability/observe-dart** — charset byte-body fix on main; note 13 + roadmap task.
- **observability backend** — local Loki at `http://localhost:3100`; phone reaches the Mac at `172.20.10.2:3100`, mind_api uses `localhost:3100`. Query via the `observe-logs` skill.
