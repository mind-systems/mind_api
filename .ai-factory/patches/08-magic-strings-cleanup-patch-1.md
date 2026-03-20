# Patch: 08 Magic Strings Cleanup

Addresses the critical issues from `reviews/08-magic-strings-cleanup-review-1.md`.

## Issue 1: `live.gateway.spec.ts` — missing `wsAuthMiddleware` constructor argument (18 tests fail)

**File:** `src/realtime/gateways/live.gateway.spec.ts`

**Problem:** `LiveGateway` constructor expects 7 parameters in this order: `(stateStore, presenceService, activityEngine, graceTimerManager, rateLimiterService, wsAuthMiddleware, configService)`. The test passes only 6 — `makeConfigService()` occupies the `wsAuthMiddleware` slot (arg 6), so `configService` (arg 7) receives `undefined`. Every test in the suite crashes with `TypeError: Cannot read properties of undefined (reading 'get')` when the constructor calls `configService.get(...)`.

**Fix:** Add a `WsAuthMiddleware` mock and pass it as the 6th constructor argument.

### Change 1a — Add `WsAuthMiddleware` import

Replace line 13:

```typescript
import { GraceTimerManager } from '../services/grace-timer.service';
```

With:

```typescript
import { GraceTimerManager } from '../services/grace-timer.service';
import { WsAuthMiddleware } from '../middleware/ws-auth.middleware';
```

### Change 1b — Add mock factory and variable

Replace lines 49-55:

```typescript
describe('LiveGateway — single-connection policy', () => {
  let gateway: LiveGateway;
  let stateStore: StateStore;
  let presenceService: jest.Mocked<PresenceService>;
  let activityEngine: jest.Mocked<ActivityEngine>;
  let graceTimerManager: jest.Mocked<GraceTimerManager>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
```

With:

```typescript
describe('LiveGateway — single-connection policy', () => {
  let gateway: LiveGateway;
  let stateStore: StateStore;
  let presenceService: jest.Mocked<PresenceService>;
  let activityEngine: jest.Mocked<ActivityEngine>;
  let graceTimerManager: jest.Mocked<GraceTimerManager>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let wsAuthMiddleware: jest.Mocked<WsAuthMiddleware>;
```

### Change 1c — Instantiate mock and pass to constructor

Replace lines 80-88:

```typescript
    gateway = new LiveGateway(
      stateStore,
      presenceService,
      activityEngine,
      graceTimerManager,
      rateLimiterService,
      makeConfigService(),
    );
```

With:

```typescript
    wsAuthMiddleware = {
      middleware: jest.fn(),
    } as unknown as jest.Mocked<WsAuthMiddleware>;

    gateway = new LiveGateway(
      stateStore,
      presenceService,
      activityEngine,
      graceTimerManager,
      rateLimiterService,
      wsAuthMiddleware,
      makeConfigService(),
    );
```

---

## Issue 2: `telemetry.gateway.spec.ts` — missing `wsAuthMiddleware` constructor argument

**File:** `src/realtime/gateways/telemetry.gateway.spec.ts`

**Problem:** `TelemetryGateway` constructor expects 4 parameters: `(activityEngine, streamEngine, rateLimiterService, wsAuthMiddleware)`. The test passes only 3. The 4th parameter (`wsAuthMiddleware`) silently receives `undefined`. This doesn't crash today because `wsAuthMiddleware` is only invoked in `afterInit()` which is not exercised in tests, but the constructor binding is wrong and will break as soon as any test or code change touches that dependency.

**Fix:** Add a `WsAuthMiddleware` mock and pass it as the 4th constructor argument.

### Change 2a — Add `WsAuthMiddleware` import

Replace line 4:

```typescript
import { RateLimiterService } from '../services/rate-limiter.service';
```

With:

```typescript
import { RateLimiterService } from '../services/rate-limiter.service';
import { WsAuthMiddleware } from '../middleware/ws-auth.middleware';
```

### Change 2b — Pass mock to constructor

Replace lines 61-65:

```typescript
    gateway = new TelemetryGateway(
      activityEngine,
      streamEngine,
      makeRateLimiterService(),
    );
```

With:

```typescript
    const wsAuthMiddleware = {
      middleware: jest.fn(),
    } as unknown as jest.Mocked<WsAuthMiddleware>;

    gateway = new TelemetryGateway(
      activityEngine,
      streamEngine,
      makeRateLimiterService(),
      wsAuthMiddleware,
    );
```
