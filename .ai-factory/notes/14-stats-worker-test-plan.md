# StatsWorker — Test Plan (Partial Coverage Gap)

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`StatsWorker` is a NestJS event listener that finalizes user stats after session lifecycle events (`COMPLETED`, `ABANDONED`, `INTERRUPTED`). All three handlers follow the same pattern: calculate duration, log start, call `statsService.finalise(event)` in a try/catch, log success or swallowed error.

## Instantiation

Already established in the existing spec:

```typescript
const statsService = { finalise: jest.fn().mockResolvedValue(undefined) } as unknown as StatsService;
const worker = new StatsWorker(statsService);
```

To test error paths, override `finalise` per-test:
```typescript
statsService.finalise = jest.fn().mockRejectedValue(new Error('DB error'));
```

To test logging, spy on the private logger:
```typescript
jest.spyOn(worker['logger'], 'error');
```

## Existing Coverage

- `onSessionCompleted` — happy path (finalise called with event) ✓
- `onSessionAbandoned` — happy path (finalise called with event) ✓

## Test Cases (missing only)

### `onSessionInterrupted`

- should call finalise with correct payload on session.interrupted
  - Method: `onSessionInterrupted`
  - Setup: `makeEvent()`, call handler directly
  - Assert: `statsService.finalise` called once with the event

### Error path — all 3 handlers

- should resolve (not throw) when finalise rejects in onSessionCompleted
  - Method: `onSessionCompleted`
  - Setup: `statsService.finalise = jest.fn().mockRejectedValue(new Error('fail'))`
  - Assert: `await worker.onSessionCompleted(event)` resolves without throwing
  - Assert: `logger.error` called with message containing `userId` and `sessionId`

- should resolve (not throw) when finalise rejects in onSessionAbandoned
  - Same pattern as above, different handler

- should resolve (not throw) when finalise rejects in onSessionInterrupted
  - Same pattern as above, different handler

## Gotchas

1. **Error swallowing** — handlers catch and log all errors; test must verify `await handler()` resolves, not rejects.
2. **Logger is private** — spy via `worker['logger']` or mock `Logger.prototype.error` before instantiation.
3. **Three handlers, identical logic** — parity matters; if error handling is broken for one, it should be broken for all. Test all three to catch copy-paste divergence.
4. **`@OnEvent` decorator** — not triggered in unit tests; call handlers directly.
