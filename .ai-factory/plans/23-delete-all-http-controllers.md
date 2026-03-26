# Plan: Delete all HTTP controllers

## Context
Remove every HTTP controller except `health.controller.ts` and the Google OAuth callback endpoint. The API is fully served via gRPC now; the HTTP layer is dead code. Each controller file must be deleted and its reference removed from the owning module's `controllers` array and import statements. The `GET /auth/google/callback` endpoint is a browser redirect that cannot be served via gRPC and must be preserved as a standalone HTTP controller.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Auth domain

- [x] **Task 1: Extract Google OAuth callback to a dedicated HTTP controller, then delete auth.controller.ts**
  Files: `src/users/controller/google-callback.controller.ts` (new), `src/users/auth.module.ts`, `src/users/auth.controller.ts`
  Create a new minimal controller `google-callback.controller.ts` containing only the `googleCallback()` method (lines 109-129 of `auth.controller.ts`). The new controller needs `@Controller('auth')` and depends only on `ConfigService`. In `auth.module.ts`: replace the `AuthController` import with `GoogleCallbackController` in both the import statement (line 11) and the `controllers` array (line 42), keeping `AuthGrpcController` alongside it. Then delete `src/users/auth.controller.ts`.

- [x] **Task 2: Remove UserController from user.module.ts and delete the file**
  Files: `src/users/user.module.ts`, `src/users/user.controller.ts`
  In `user.module.ts`: remove the `import { UserController } from './user.controller';` line (line 5) and remove `UserController` from the `controllers` array (line 11), leaving only `UsersGrpcController`. Delete `src/users/user.controller.ts`.

### Phase 2: Feature modules

- [x] **Task 3: Remove BreathSessionsController from breath-sessions.module.ts and delete the file**
  Files: `src/breath-sessions/breath-sessions.module.ts`, `src/breath-sessions/breath-sessions.controller.ts`
  In `breath-sessions.module.ts`: remove the `import { BreathSessionsController }` line (line 3) and remove `BreathSessionsController` from the `controllers` array (line 18), leaving only `BreathSessionsGrpcController`. Delete `src/breath-sessions/breath-sessions.controller.ts`.

- [x] **Task 4: Remove StatsController from stats.module.ts and delete the file**
  Files: `src/stats/stats.module.ts`, `src/stats/stats.controller.ts`
  In `stats.module.ts`: remove the `import { StatsController }` line (line 7) and remove `StatsController` from the `controllers` array (line 13), leaving only `StatsGrpcController`. Delete `src/stats/stats.controller.ts`.

- [x] **Task 5: Remove DeviceController from device.module.ts and delete the file**
  Files: `src/device/device.module.ts`, `src/device/device.controller.ts`
  In `device.module.ts`: remove the `import { DeviceController }` line (line 4) and remove `DeviceController` from the `controllers` array (line 10), leaving only `DeviceGrpcController`. Delete `src/device/device.controller.ts`.

- [x] **Task 6: Remove SyncController from sync.module.ts and delete the file**
  Files: `src/sync/sync.module.ts`, `src/sync/sync.controller.ts`
  In `sync.module.ts`: remove the `import { SyncController }` line (line 3) and remove `SyncController` from the `controllers` array (line 9), leaving only `SyncGrpcController`. Delete `src/sync/sync.controller.ts`.

### Phase 3: Verification

- [x] **Task 7: Build verification** (depends on Tasks 1-6)
  Run `npm run build` to confirm the project compiles cleanly with no broken imports or leftover references to deleted controllers.

## Commit Plan
- **Commit 1** (after tasks 1-7): "Delete all HTTP controllers, preserve Google OAuth callback as standalone HTTP endpoint"
