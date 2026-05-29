# Web Dashboard REST API — Implementation Spec

**Source:** `notes/09-web-dashboard-api-requirements.md`  
**Phase:** 21

## Context

The backend is gRPC-native. The web dashboard needs standard REST/JSON. This phase adds a thin HTTP layer on top of existing services — no new business logic, no database schema changes.

Current HTTP surface: `GET /health`, `GET /auth/google/callback`. Everything else is gRPC.

---

## Milestone 1 — Auth REST: `send-code` + `verify-code`

**New file:** `src/users/controller/auth.rest.controller.ts`  
**Register in:** `AuthModule` (`src/users/auth.module.ts`), alongside `AuthGrpcController`

Both endpoints are unauthenticated (no guard). Use `class-validator` DTOs.

```
POST /auth/send-code   body: { email: string, locale?: string }  → { message: 'ok' }
POST /auth/verify-code body: { email: string, code: string }     → AuthResponseDto
```

Delegate to `AuthCodeService` (`src/users/service/auth-code.service.ts`):
- `sendCode(email, locale)` — returns void, respond with `{ message: 'ok' }`
- `verifyCode(email, code)` — returns `AuthResponseDto` (pass through as-is)

**Pitfall:** Check whether `AuthCodeService` is listed in `AuthModule.exports`. If not, add it. If the gRPC controller injects `AuthCodeService` directly (confirmed it does), only an export needs to be added — no logic change.

---

## Milestone 2 — Google OAuth REST: initiator + code exchange

**Extend existing:** `src/users/controller/google-callback.controller.ts`

New endpoints in the same controller:

```
GET  /auth/google       → 302 redirect to Google OAuth URL
POST /auth/google       body: { code: string, redirectUri: string } → AuthResponseDto
```

**`GET /auth/google` implementation:**

Inject `ConfigService`. Construct URL:
```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id={GOOGLE_CLIENT_ID}
  &redirect_uri={WEB_REDIRECT_URI}
  &scope=openid email profile
  &response_type=code
  &access_type=offline
```
Use `@Res() res: Response` and `res.redirect(302, url)`. Do not set `access_type=offline` if refresh tokens aren't needed — remove it if the web app doesn't use refresh tokens.

**`POST /auth/google` implementation:**

Look at how `AuthGrpcController.googleAuth` delegates: it calls whichever service handles the full OAuth → user-find/create → session → JWT flow. Reuse the same service call from the REST controller. The `GoogleTokenService.exchangeCodeForProfile(code, redirectUri)` handles browser OAuth when `redirectUri` is provided.

**New env var:** `WEB_REDIRECT_URI`  
Value: `{APP_BASE_URL}/auth/google/callback`  
Add to: `.env`, `.env.dev`, `.env.prod`  
Also register in `GoogleCallbackController` as an injected config key.

---

## Milestone 3 — `SessionsModule` + `GET /sessions/runs`

**New module:** `src/sessions/`

```
src/sessions/
  sessions.module.ts
  sessions.service.ts
  sessions.controller.ts
```

`SessionsModule` imports:
- `TypeOrmModule.forFeature([ModuleSession])` — TypeORM allows the same entity in multiple modules; no changes to `RealtimeModule`
- `AuthModule` — to make `JwtAuthGuard` available

`ModuleSession` entity: `src/realtime/entities/module-session.entity.ts`

**`GET /sessions/runs?limit=50&offset=0`**

Guard: `@UseGuards(JwtAuthGuard)`, inject user via `@CurrentUser()` (`src/users/decorators/current-user.decorator.ts`).

Service query:
```ts
repo.findAndCount({
  where: { userId: user.sub, endedAt: Not(IsNull()) },
  order: { startedAt: 'DESC' },
  take: Math.min(limit ?? 50, 200),
  skip: offset ?? 0,
})
```

Response shape:
```ts
{
  items: [{ id, startedAt, endedAt, durationSeconds }],
  total: number
}
```
`durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)`

Register `SessionsModule` in `AppModule`.

---

## Milestone 4 — `GET /sessions/runs/:id/biometrics` + `GET /sessions/runs/:id/instructions`

Extend `SessionsModule` only — no new module.

Add to `TypeOrmModule.forFeature`: `BioSessionSample`, `SessionStreamSample`  
Entities:
- `src/realtime/entities/bio-session-sample.entity.ts`
- `src/realtime/entities/session-stream-sample.entity.ts`

**Why time-range, not offset pagination:**  
A multi-hour session can produce gigabytes of flattened samples. Offset-based pagination maps poorly to a chart — the frontend needs data for the *visible time window*, not an arbitrary row slice. The web chart (ECharts dataZoom) fetches the visible range on scroll; the API returns exactly that window.

**Query params (both endpoints):**
```
?from=<ISO 8601 timestamp>   optional, inclusive
?to=<ISO 8601 timestamp>     optional, exclusive
```
If neither param is provided, return all rows (acceptable for short sessions; the frontend should always supply a range for long ones).

**Ownership check (shared):**
```ts
const session = await moduleSessionRepo.findOne({ where: { id: sessionId } });
if (!session) throw new NotFoundException();
if (session.userId !== user.sub) throw new ForbiddenException();
```

**Biometrics:**
```ts
const where: FindOptionsWhere<BioSessionSample> = { moduleSessionId: sessionId };
if (from) where.flushedAt = MoreThanOrEqual(new Date(from));
if (to)   where.flushedAt = LessThan(new Date(to));
// If both: use Between(new Date(from), new Date(to))
const rows = await bioRepo.find({ where, order: { flushedAt: 'ASC' } });
return rows.flatMap(row => row.samples);
// Each sample: { timestamp, sampleType, data }
```

**Instructions:** identical pattern on `session_stream_samples`.  
Each sample: `{ timestamp, type, payload }`

Both endpoints: `@UseGuards(JwtAuthGuard)`, `@CurrentUser()`.

---

## Milestone 5 — `GET /nfb-calibrations` REST endpoint

**New file:** `src/nfb-calibration/nfb-calibration.rest.controller.ts`  
**Register in:** `NfbCalibrationModule` — also add `AuthModule` to its imports.

```
GET /nfb-calibrations?deviceSerial=&limit=50&offset=0
→ { records: NfbCalibrationRecordDto[], total: number }
```

Guard: `@UseGuards(JwtAuthGuard)`, `@CurrentUser()`.

**Update `list()` signature** — current `list(userId, deviceSerial, limit)` always requires deviceSerial and has no pagination. Replace with:

```ts
async list(
  userId: string,
  deviceSerial?: string,
  limit = 50,
  offset = 0,
): Promise<[NfbCalibrationRecord[], number]> {
  const where: FindOptionsWhere<NfbCalibrationRecord> = { userId };
  if (deviceSerial) where.deviceSerial = deviceSerial;
  return this.repo.findAndCount({
    where,
    order: { createdAt: 'DESC' },
    take: Math.min(limit, 200),
    skip: offset,
  });
}
```

Controller maps `[records, total]` to `{ records, total }`.

**Pitfall:** The gRPC `list` method also calls this service. Update the gRPC controller call to pass the new signature — `limit` stays as-is (gRPC has its own `limit` field), `offset` defaults to `0`, `deviceSerial` stays required for gRPC (proto field is always present, just empty string for "all").

---

## Common Patterns

**HTTP guard import path:**  
```ts
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
// or re-exported from AuthModule — check AuthModule.exports
```

**`@CurrentUser()` for HTTP:**  
```ts
import { CurrentUser } from '../users/decorators/current-user.decorator';
// Returns JwtPayload; use payload.sub for userId
```

**Module import for `JwtAuthGuard`:**  
Any module using `JwtAuthGuard` must import `AuthModule` in its `imports: []`.
