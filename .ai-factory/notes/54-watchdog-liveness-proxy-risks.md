# Watchdog risks — `lastActivityAt` is a data-liveness proxy, not session-liveness

**Date:** 2026-06-20
**Source:** conversation context (post-implementation review of Phase 41 keepalive + Phase 42 idle-session watchdog)

## Key Findings

- Phase 41 (server gRPC keepalive) and Phase 42 (`SessionWatchdogService` + `ActivityEngine.abandonStale`) are both shipped (commits `6b21fbf`, `8810274`, `f7f26f8`) and faithful to spec. DI wiring is correct, the code compiles (the 3 `tsc` errors are pre-existing, in `biometric-stream-engine.service.spec.ts`, unrelated). The risks below are **behavioral**, not crashes.
- **Core problem:** the watchdog reaps on `module_sessions.last_activity_at`, which tracks **data-liveness** ("last sample persisted"), not **session/transport-liveness** ("client still connected"). Before Phase 41 those roughly coincided. After Phase 41 they diverge — keepalive now makes transport-liveness independently observable — so the watchdog's remaining unique job (reaping where keepalive did not) overlaps heavily with the one case that is risky: a client that is **transport-alive but data-idle**.
- **P1 — false reap of a live session.** A session can be `ACTIVE`, the control transport alive and acking keepalive pings, yet produce no biometric/instruction samples for >10 min → `last_activity_at` stalls → the watchdog sets it `ABANDONED`. Reachable scenario: meditation **has no pause** (per product), so a BCI-headband dropout mid-meditation (bad contact, user adjusts the band) for >10 min kills a session the user is still in. Same for the app backgrounded while holding the connection.
- **P2 — split-brain (no client notification).** `abandonStale` has **no transport/notify path** (verified: it references neither `ActiveStreamRegistry` nor any `subscriber`). When it reaps a session whose streams are still open, the in-memory store + engine buffers are cleared but the client is told nothing. Its still-open biometric/instruction streams then get `NO_SESSION` on every batch, and those handlers do `subscriber.next({error})` + `return` — the stream **stays open**, so no `onError`/`onDone` fires on the client and no reconnect is triggered. The client believes the session is live; the server has discarded it. Recovery only happens if the client reopens the **control** stream (the only place `handleReconnect` runs). **This is fixed by M1, not M2:** since M1 never reaps a `userId` that still has an open stream, the split-brain cannot arise on the normal path — only a connect-during-sweep race can still strand a straggler, which M2 cleans up (see Mitigations).
- **P3 — `last_activity_at` is best-effort and narrow.** The flush bump is fire-and-forget (`stream-engine.service.ts:163-170` / `biometric-stream-engine.service.ts:184` — `.update(...).catch(log)`, not awaited), and it is **not** bumped on pause/unpause (those touch only in-memory `state.lastActivityAt` at `activity-engine.service.ts:314,346`, never the DB row). So the watchdog clock can be stale even for a healthy session.
- **P4 — minor, not a bug.** `src/main.ts` reads keepalive env as `Number(process.env.X) || default`. For `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS`, `0` is falsy → coerced to the default `1`, so the flag cannot be disabled via env. Cosmetic; the default is the desired value.

## Details

### Where `last_activity_at` advances (full enumeration)

DB writes: `activity-engine.service.ts:45` (create), `:388` (resume on reconnect), `stream-engine.service.ts:164` (flush, fire-and-forget), `biometric-stream-engine.service.ts:184` (flush, fire-and-forget). In-memory-only (no DB): `:314`/`:346` (pause/unpause). **Nothing bumps it from control-stream liveness** — an idle-but-connected control stream does not advance the clock. So `last_activity_at` answers "when did data last persist," not "is the client there."

### Why Phase 41 sharpens the risk instead of hiding it

Post-keepalive, a genuinely dead transport is reaped in ~40s (keepalive) + 30s (grace) ≈ 70s — long before the 10-min watchdog window. So the sessions still `ACTIVE` with stale `last_activity_at` at the 10-min mark are predominantly the ones where **the transport is alive** (keepalive passing) but data stopped. That is exactly the population P1/P2 are about. The watchdog still has legitimate, safe targets — see below — but its risky and its useful targets are distinguished only by transport-liveness, which it currently does not consult.

### Where the watchdog is unambiguously correct (keep it)

- **DB-only orphans**: rows left `ACTIVE`/`DISCONNECTED` with no in-memory state and no live stream (e.g. a crash between `StartupRecoveryService` runs, or keepalive disabled via env). No client exists to notify; reaping is pure win.
- **Transport already gone but grace missed**: belt-and-suspenders for any path where the teardown/grace chain did not finalize.

The value is real; the fix is to make the watchdog *distinguish* these from live clients, not to remove it.

### The fix is a reframe, not a number

`WS_SESSION_MAX_IDLE_MS` is the **wrong axis for a connected client.** Keepalive (Phase 41) split "client alive" from "data flowing"; a session must be reaped on the **first**, but the watchdog measures the **second**. So "how long can the headband stay silent mid-session" is not a number to tune — for a *connected* client the answer is **as long as the stream is alive**: the server is not entitled to declare a connected user finished. Do **not** size the threshold "long enough to survive a dropout" — that treats the symptom. The resolution is to reap by liveness (M1); the threshold is secondary and only governs the no-live-stream path.

The session lifecycle is then a composition of three windows, each on its proper axis:
1. **Connected** (any live stream) → never reaped — **M1**.
2. **Briefly dropped** (all streams down, reconnecting) → protected by the reconnect **grace** window.
3. **Truly gone** (no stream, grace elapsed / missed) → reaped on the **idle threshold**.

### Mitigations — M1 + M2 together (both belong in Phase 42)

- **M1 — reap only when the user has no live subscriber (primary lever).** Inject `ActiveStreamRegistry` into the watchdog and skip any session whose `userId` still has a registered subscriber. Note the registry is `Map<userId, Set<Subscriber>>` — it does **not** record stream type, so the check is **"no live subscriber at all for this userId,"** not "no control stream." That is the better predicate anyway: *any* open stream (control, instruction, or biometric) means the client is on the line, and a connected client is never reaped. Post-Phase-41 the registry is trustworthy (dead streams deregister within ~40s; the pre-Phase-41 zombie-subscriber inflation that drove `connectedStreams` 4→6 is exactly what keepalive removes). This eliminates the P1 false reap — **and the P2 split-brain too**, since a session with an open stream is never reaped in the first place. Note the predicate keys on `userId`, not `sessionId`: a connected user's *unrelated* stale orphan row is skipped while they hold any stream, and reaped only once they disconnect — benign under one-active-session-per-user + `StartupRecoveryService`, but call it out as an explicit decision.
- **M2 — race-hardening on the residual reap (not the P2 fix).** With M1 in place, P2 can no longer happen on the normal path: on case 3 there is no live stream, so `closeAll(userId)` is a no-op. M2 exists for one narrow gap — a client that opens a stream **between** M1's registry check and the `abandonStale` call in the same sweep iteration. For that straggler, call `ActiveStreamRegistry.closeAll(userId)` after `abandonStale` so its stream closes, `onDone` fires, and it reconnects clean. So **P2 is fixed by M1**; M2 is the cleanup contract for the connect-during-sweep race.
- **Both go in Phase 42** (not M1 *or* M2). M1 is the main lever (fixes P1 and P2); M2 is the race-cleanup contract.

### The threshold still exists — but only for the no-live-stream path

For case 3 (DB-orphans, missed grace — the cases where the watchdog is unambiguously right, no client to notify) the threshold is non-load-bearing for false reaps. Its **only** hard requirement is:

> `WS_SESSION_MAX_IDLE_MS` **>** the reconnect-grace window (`WS_RECONNECT_GRACE_MS`), with margin.

Otherwise a client whose streams all briefly dropped (window 2) falls into the gap between "control down" and "control back up" and gets eaten before grace resolves. Current values satisfy this: grace `DEFAULT_GRACE_MS = 30_000` (30s, `activity-session-store.service.ts:5`) vs threshold default `600_000` (10 min, `session-watchdog.service.ts:32`) — 20× margin. Confirm this invariant holds for any configured override.

### P4 — separate micro-milestone, do not bundle

`Number(process.env.X) || default` makes `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=0` unreachable (`0` is falsy → default `1`). Fix with a NaN-checked parse or `??`. Logically unrelated to the watchdog — its own tiny milestone, not folded into M1/M2.

### Severity / likelihood

In the **happy path** (continuous biometrics) `last_activity_at` is fresh every few seconds → zero false reaps today. The risk window is strictly *connected + data-silent > threshold*. M1 removes that window entirely by switching the predicate to liveness, so likelihood stops depending on how often a connected client goes data-silent — which is the whole point of the reframe.

## Open Questions

- **The one real product question (not an engineering tuning knob): do we ever want to reap a *connected* client?** — phone on the line, headband off for an hour, user walked away. Position from this review: **no.** Ending a connected session is the client's job (foreground/background transitions, headband-off → send `stop`), not the server's; reaping a connected client just re-introduces P1. If the product instead wants a hard ceiling, that is a **separate "max session duration" policy on its own axis** (wall-clock since `startedAt`), explicitly *not* the idle-on-data threshold — do not conflate the two. Decide whether such a ceiling is wanted; if yes, it is a distinct milestone, not part of the watchdog reframe.
