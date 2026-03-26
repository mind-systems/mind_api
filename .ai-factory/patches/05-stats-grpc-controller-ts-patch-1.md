# Patch: 05-stats-grpc-controller-ts — Review 1

## Issue 1: Non-null assertion `user!.sub` violates RULES.md

**File:** `src/stats/stats.grpc.controller.ts`
**Severity:** Critical (hard rule violation)
**Rule:** `RULES.md` — "NEVER use non-null assertion operator (`!`)"

### Problem

Line 27 uses `user!.sub` to force-unwrap the `user` parameter. While `GrpcAuthInterceptor` guarantees `user` is populated for non-optional-auth endpoints, the project rules require an explicit guard. Every other gRPC controller (`users.grpc.controller.ts`, `breath-sessions.grpc.controller.ts`) checks `if (!user)` before accessing properties.

### Fix

Two changes in `src/stats/stats.grpc.controller.ts`:

**1. Add missing imports (line 1)**

```diff
 import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
+import { RpcException } from '@nestjs/microservices';
+import { status as GrpcStatus } from '@grpc/grpc-js';
 import {
```

**2. Replace `user!.sub` with explicit guard (lines 26–27)**

```diff
   ): Promise<GetStatsResponse> {
-    const result = await this.statsService.getStats(user!.sub);
+    if (!user) {
+      throw new RpcException({
+        code: GrpcStatus.UNAUTHENTICATED,
+        message: 'Authentication required',
+      });
+    }
+
+    const result = await this.statsService.getStats(user.sub);
```

### Final state of `src/stats/stats.grpc.controller.ts`

```typescript
import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  GetStatsRequest,
  GetStatsResponse,
  StatsServiceController,
  StatsServiceControllerMethods,
} from '../../proto/generated/stats';
import { StatsService } from './stats.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@StatsServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class StatsGrpcController implements StatsServiceController {
  constructor(
    private readonly statsService: StatsService,
  ) {}

  async getStats(
    _request: GetStatsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<GetStatsResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }

    const result = await this.statsService.getStats(user.sub);

    return {
      totalSessions: result.totalSessions,
      totalDurationSeconds: result.totalDurationSeconds,
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
      lastSessionDate: result.lastSessionDate ?? undefined,
      maxCompletedComplexity: result.maxCompletedComplexity,
    };
  }
}
```
