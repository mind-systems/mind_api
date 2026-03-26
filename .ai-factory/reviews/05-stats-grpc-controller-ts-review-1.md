## Code Review Summary

**Files Reviewed:** 2
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — WARN: no issues. Controller is thin, delegates to service, module boundaries respected.
- **RULES.md** — ERROR: non-null assertion operator `!` used on line 27 of `stats.grpc.controller.ts`. This is an explicit hard rule: "NEVER use non-null assertion operator (`!`)".
- **ROADMAP.md** — WARN: milestone `stats.grpc.controller.ts` is checked off in section 1.3 but not recorded in the Completed table at the bottom. Non-blocking.

### Critical Issues

**1. Non-null assertion `user!.sub` violates RULES.md**
File: `src/stats/stats.grpc.controller.ts`, line 27

```typescript
const result = await this.statsService.getStats(user!.sub);
```

RULES.md explicitly forbids the `!` operator. Every other gRPC controller in the project guards with an explicit null check before accessing `user.sub`. Compare with `users.grpc.controller.ts` (line 31) and `breath-sessions.grpc.controller.ts` (line 56):

```typescript
if (!user) {
  throw new RpcException({
    code: GrpcStatus.UNAUTHENTICATED,
    message: 'Authentication required',
  });
}
```

Fix: add the same guard, then use `user.sub` without `!`. This also requires adding `RpcException` and `GrpcStatus` imports:

```typescript
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';

// ...

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
  // ...
}
```

### Positive Notes

- Clean migration from manual JWT extraction to `GrpcAuthInterceptor` + `@GrpcCurrentUser()` — constructor only injects `StatsService`, no leftover dependencies.
- `lastSessionDate: result.lastSessionDate ?? undefined` correctly handles `null` to proto optional field mapping.
- Module wiring is correct — `AuthModule` was already imported, no changes needed.
- Controller is thin — just delegates to `StatsService` and maps the response.
