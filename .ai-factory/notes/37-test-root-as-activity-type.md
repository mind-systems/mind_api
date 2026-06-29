# Corrective test plan — root as a client-started `activityType=root` session (module-state)

**Date:** 2026-06-29
**Source:** conversation context (handoff 08-root-as-module-activity-type §3-C-1)

Corrective test task. Guards [[34-deliver-root-id-on-connect]] (a1). **Supersedes** the now-wrong connect-frame/`isRoot` assertions that T1 committed in `module-state.grpc.controller.spec.ts` (commit `5221b38`, recorded by the frozen [[31-test-root-id-on-connect]]). Because that spec is committed, this is a **new task in a test phase**, not an edit to the frozen `[x]` T1 task. Do not touch note 31's body.

## Why this exists (the pivot)
The architecture changed: the root is no longer announced on connect with an `is_root` flag. It is a **client-started** module session opened by `activity:start { activity_type: ROOT }`, discriminated by `activity_type === ROOT` on the returned `session:state`. So every committed assertion that expects a connect-time ROOT frame or an `isRoot` boolean is **wrong** and must be reverted; new targets assert the ROOT-start contract.

## Red/Green contract
- **Target (RED until [[34-deliver-root-id-on-connect]]):** `activity:start { activity_type: ROOT }` emits one `session:state` with `activity_type === ROOT` + `moduleSessionId = root.id`; idempotent (second ROOT start, same user → same id); a child start carries `activity_type !== ROOT`; `activity:end`/`activity:stop` on the root → `CANNOT_END_ROOT`.
- **Characterization (stay GREEN):** auth, teardown, setup-error, `handleSessionRevoked`, and the reconnect RESUMED/ABANDONED frames (now **without** any appended ROOT frame).

## Reverts — by file:line against the **current committed** spec (`5221b38`)
Each of these asserts the withdrawn connect-ROOT/`isRoot` design. Revert to the no-connect-frame shape and **delete every `isRoot` assertion**:

- **`(a)` RESUMED `:151-180`** — currently asserts `[RESUMED, ROOT]` `toHaveLength(2)` (`:171`), `values[1].moduleSessionId === 'root-1'` (`:176`), `(values[1]…).isRoot === true` (`:177`). → revert to `[RESUMED]` `toHaveLength(1)`; keep the `values[0]` RESUMED `toMatchObject` (`:172-175`); drop `:176-177` and the `ensureRoot.mockResolvedValue(root-1)` setup if unused.
- **fresh-connect `:202-223`** — `it('should emit the root frame on a fresh connect when handleReconnect returns null')` asserts `toHaveLength(1)` (`:218`), `moduleSessionId === 'root-1'` (`:219`), `isRoot` (`:220`). → revert to **no emission**: `expect(values).toHaveLength(0)` (rename the `it` to "should not emit any frame on a fresh connect"). Mirrors the original pre-T1 behavior.
- **`(b)` ABANDONED `:283-313`** — asserts `[ABANDONED, ROOT]` `toHaveLength(2)` (`:303`), `values[1]` root-1 (`:308`), `isRoot` (`:309`). → revert to `[ABANDONED]` `toHaveLength(1)`; keep `values[0]` ABANDONED (`:304-307`); drop `:308-309`.
- **`(c)` `:315-338`** — `it('should emit the root frame on connect when handleReconnect returns null and no clientSessionId')` asserts `toHaveLength(1)` (`:331`), root-1 (`:332`), `isRoot` (`:333`). → revert to **no emission** (`toHaveLength(0)`).
- **`:340-361`** — `it('should emit a session:state carrying the root id on a fresh connect')`, asserts `values.some(v => v.sessionState?.moduleSessionId === 'root-1')` (`:357`). → **delete** (there is no connect root frame). Its intent is replaced by the ROOT-start target below.
- **`:363-401`** — `it('should distinguish the root frame from a child by isRoot === true')`: asserts root frame `isRoot === true` (`:391`), child frame `isRoot` falsy (`:398`). → **replace** with the `activity_type` discriminator target (see New targets): root-start frame `activity_type === ROOT`, child-start frame `activity_type !== ROOT`.
- **`:403-432`** — `it('should announce the root id after the RESUMED frame on a resumed-child reconnect')`: `[RESUMED, ROOT]` len 2 (`:422`), `values[1]` root-1 (`:428`), `isRoot` (`:429`). → **delete** (no announced ROOT frame; the RESUMED-only shape is already covered by the reverted `(a)`).
- **`(d)` `:436-477`** — asserts `[ABANDONED, ROOT]` len 2 (`:458`), `values[1]` root-1 (`:460`), then after `activityStart` `toHaveLength(3)` (`:469`) with `values[2]` ACTIVE new-session (`:470-471`). → revert to `[ABANDONED]` len 1 (drop `:460`); after `activityStart` `toHaveLength(2)`, `values[1]` ACTIVE new-session.

**Keep GREEN unchanged:** `:182-199` (resumed id at `values[0]`, no length/`isRoot`); `:225-244` (subscribe ordering); `:246-281` (subscriber-closed → len 0); the auth/teardown/setup-error/`handleSessionRevoked` describes.

## New targets (RED until a1) — add to a `describe('trackActivity — client-started root')`
Vantage: capture `values[]` from `trackActivity(request$, user)`, drive commands via `request$.next(...)`, `await flushMicrotasks()`. Mock additions to `makeActivityEngine()` (`spec :28-44`, which today has `ensureRoot`, `startActivity`, `endActivity`, `stopActivity`, `getSoleChild`, `listLiveSessions`, **no** `getRootId`):
- add **only `getRootId: jest.fn()`** — the delegate a1 uses on the reject-end path (`resolved.sessionId === activityEngine.getRootId(userId)`). None of this note's targets need `getSession` (ROOT-start mocks `ensureRoot`, child-start mocks `startActivity`).

Cases:
- **ROOT start emits an ACTIVE frame with `activity_type === ROOT`** — `ensureRoot.mockResolvedValue(makeSession({ id: 'root-1' }))`; `request$.next({ activityStart: { activityType: ActivityType.ROOT } })`; assert one `session:state` with `moduleSessionId === 'root-1'`, `status === ACTIVE`, and `(frame.sessionState as any).activity_type === ActivityType.ROOT` (cast — the generated stub gains `activity_type` only when a1 regenerates; compile-now). RED today: `mapProtoActivityType` throws on ROOT → an `INVALID_ACTIVITY_TYPE` error frame instead.
- **ROOT start routes through `ensureRoot`, not `startActivity`** — assert `activityEngine.ensureRoot` called, `activityEngine.startActivity` **not** called for the ROOT command (guards the wrong-`rootSessionId` trap).
- **idempotent** — two `activity:start ROOT` for one user → both frames carry the same `moduleSessionId` (ensureRoot identity), independent of `client_activity_id`.
- **child start carries a non-ROOT `activity_type`** — `startActivity.mockResolvedValue(makeSession({ id: 'child-1', activityType: 'breath' }))`; `activityStart { BREATH }`; assert the frame's `activity_type !== ROOT`.
- **reject root end** — `activityEngine.getRootId.mockReturnValue('root-1')` so the controller sees the target as the root; `request$.next({ activityEnd: { sessionId: 'root-1' } })`; assert a `session_error` frame `code === 'CANNOT_END_ROOT'`, and `activityEngine.endActivity` **not** called, no COMPLETED frame. Same for `activityStop` → no INTERRUPTED. (Mock **`getRootId`**, not `getSession` — a1's guard reads `getRootId`; leaving it `undefined` would make `resolved.sessionId === undefined` false → no reject → the target would stay RED after a1 lands, falsely signalling failure.)

## Two-state observability
Each target is RED at the controller's `handleActivityStart`/`handleActivityEnd` vantage: today ROOT throws in `mapProtoActivityType` (no ROOT frame) and root-end has no guard (would emit COMPLETED). After a1: ROOT routes to `ensureRoot` and emits `activity_type=ROOT`; root-end emits `CANNOT_END_ROOT`. Drive through `trackActivity` and assert the captured frame so a target fails cleanly, never hangs.

## Findings
- The `activity_type` proto field is added + regenerated by a1 (loud/additive, not separately unit-tested); the discriminator assertion uses a cast to compile before regen.
- This note's reverts erase the cross-epic collision that [[28-test-pause-state-integrity]] / [[24-pause-state-integrity]] referenced: with the ROOT connect frame gone, the `(a)` RESUMED case returns to `[RESUMED]` len 1, so note 28's `isPaused` inversion applies to a single-frame shape (reconciled in note 28).
