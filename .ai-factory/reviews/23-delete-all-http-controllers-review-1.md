# Review: Delete all HTTP controllers

**Files reviewed:** 14 files (6 deleted controllers, 6 modified modules, 1 new controller, plan file)
**Risk level:** Low

## Verification

### Deleted controllers

All 6 HTTP controllers are deleted:
- `src/users/auth.controller.ts`
- `src/users/user.controller.ts`
- `src/breath-sessions/breath-sessions.controller.ts`
- `src/stats/stats.controller.ts`
- `src/device/device.controller.ts`
- `src/sync/sync.controller.ts`

**Dangling references:** grep for all 6 class names across `src/` — zero matches. No imports, no type references, no test files referencing them.

### Module edits

Each of the 6 module files correctly:
- Removes the HTTP controller import statement
- Removes the HTTP controller from the `controllers` array
- Retains the corresponding gRPC controller as the sole entry

All referenced gRPC controllers exist on disk:
- `src/users/auth.grpc.controller.ts`
- `src/users/users.grpc.controller.ts`
- `src/breath-sessions/breath-sessions.grpc.controller.ts`
- `src/stats/stats.grpc.controller.ts`
- `src/device/device.grpc.controller.ts`
- `src/sync/sync.grpc.controller.ts`

### Google OAuth callback extraction

`src/users/controller/google-callback.controller.ts` is a faithful copy of the `googleCallback()` method from the deleted `auth.controller.ts` (lines 109-129). Verified:

- `@Controller('auth')` prefix matches the original — route stays `GET /auth/google/callback`
- Single dependency: `ConfigService` (globally available, no module import needed)
- Logger class name updated to `GoogleCallbackController.name`
- No route conflict with `AuthGrpcController` (which uses bare `@Controller()` for gRPC)
- `auth.module.ts` correctly imports `GoogleCallbackController` from `./controller/google-callback.controller` and registers it in `controllers` array

### Untouched files

- `app.module.ts` — no references to deleted controllers; `HealthController` untouched
- `main.ts` — no references to deleted controllers; Swagger setup still present (generates docs from remaining HTTP controllers only)
- No `.spec.ts` files exist for any of the deleted controllers

## Issues

None found.

## Suggestions

**1. Swagger will be nearly empty**

With only `HealthController` and `GoogleCallbackController` remaining as HTTP controllers, the Swagger UI at `/api/docs` will show just the health check and the Google callback route. The callback has no Swagger decorators (`@ApiOperation`, `@ApiTags`, etc.), so it won't appear in Swagger at all. This is fine — just noting that Swagger is now effectively empty. Consider removing the Swagger setup in a future cleanup if the HTTP surface is intentionally minimal.

REVIEW_PASS
