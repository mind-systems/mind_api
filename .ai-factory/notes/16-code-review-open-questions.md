# Code Review — Open Questions, RESOLVED (Phases 15–23)

**Date:** 2026-05-31
**Source:** code review (notes 13–15) + parallel Explore research (4 agents)

All six open questions from the review were researched and decided. Nothing remains uncertain — per the agreed rule, anything still doubtful after research was discarded. This note is the resolution log.

## Became confident mind_api fix tasks (ROADMAP)

### 1. Google OAuth `state` (login-CSRF) → **Phase 26** (+ mind_web requirements note)
Research (OAuth-flow agent): the SPA initiates via `GET /auth/google`, the backend sets no cookies, and the SPA owns the OAuth session. Best practice for this relay: SPA generates/stores/validates `state`; backend is a transparent relay.
- **mind_api:** Phase 26 — relay `state` through `GET /auth/google` + callback, accept it (unvalidated) on `POST /auth/google`.
- **mind_web (do not touch — requirements only):** `mind_web/.ai-factory/notes/13-oauth-state-csrf-requirements.md` — generate `state` in `sessionStorage` before redirect, validate on callback before exchange.
- Must ship together; backend half is a no-op alone.

### 2. OTP verify brute-force → **Phase 27** (elevated from LOW)
Research (throttling agent) reframed this as serious: `verifyCode` accepts a 6-digit code (900k space), 15-min expiry, single-active per email, but **no failed-attempt lockout and no HTTP throttle**; REST endpoints public/unguarded. Brute-forceable within the expiry window. `sendCode` already has a 60s per-email cooldown.
- Phase 27 task A — per-email failed-attempt lockout on `AuthCode` (new `failedAttempts`/`lockedUntil` columns + migration; rework `verifyCode` to load the active row by email so misses can be counted, lock after 5 for 15 min). Primary control, survives restarts/replicas.
- Phase 27 task B — `@nestjs/throttler` on the two public auth REST routes only (NOT global — gRPC/streaming must stay unthrottled). IP-layer defense-in-depth.

### 3. revoke-with-`stopActivity`-failure stale state → **Phase 28**
Research (lifecycle agent): concern (a) is reachable but bounded — a fast reconnect within the ~30s grace window can resurrect a phantom session; the grace timer's `abandonActivity` guard clears it after, and startup-recovery reconciles the DB on restart. Minimal correct fix: clear in-memory state in a `finally` in `stopActivity`.
- Phase 28 — wrap `stopActivity` body in `try { … } finally { activitySessionStore.delete(userId) }`. Identical on the happy path; closes the leak on failure.

## Discarded after research (harmless / by-design)

### 4. bio `dropped_count` cumulative vs instruction per-message → **DISCARDED (harmless)**
Mobile consumer ignores the ack `dropped_count` entirely — only `maxSamplesPerSecond` is read (`ModuleInstructionStream.dart`, `BreathModuleInstructionStream.dart`), and the biometric ack handler is a no-op (`BiometricStreamClient.dart`). The semantic difference is unobservable to any client.

### 5. gRPC `NfbCalibrationService.list` empty-serial → all devices → **DISCARDED (harmless)**
Mobile always passes a non-empty `deviceSerial` (`NfbCalibrationRepository.refreshFromServer(serial)` over paired serials); no other gRPC consumer exists. The empty-serial branch is unreachable, and the service still scopes by `user.sub` regardless.

### 6. `GET /nfb-calibrations` returns raw entities (own `userId`) → **DISCARDED (harmless)**
The mind_web type even declares `userId` and never reads it; extra JSON fields don't break the client. No cross-user leak (user-scoped). Pure cosmetics.

### (b) `stats.worker` does not handle `REVOKED` → **DISCARDED (by-design)**
Confirmed against note 04 intent: `REVOKED` is flush-only. A failed finalize has no terminal DB row with `endedAt` to aggregate, so not updating stats is correct. Phase 28 explicitly says not to add a stats handler.

## Net result
- **3 new mind_api fix phases**: 26 (OAuth relay), 27 (OTP brute-force), 28 (stale state).
- **1 cross-project requirements note** handed to mind_web (OAuth `state` SPA half).
- **4 items discarded** as harmless/by-design. No remaining uncertainty.
