# Review: Wire gRPC transport in main.ts

**Files reviewed:** `src/main.ts`, `.env`, `.env.dev`, `.env.prod`, `Dockerfile`, all 8 `.proto` files, all 6 gRPC controllers, `grpc-auth.interceptor.ts`, `grpc-exception.filter.ts`, `package.json`

**Risk level:** 🟡 Medium

---

## Context gates

- **ARCHITECTURE.md** — `OK`: Changes are limited to the bootstrap layer (`main.ts`) and env config. No module boundary violations.
- **ROADMAP.md** — `OK`: Implements milestone 1.5 ("Wire gRPC transport in `main.ts`").
- **Plan alignment** — `OK`: All plan tasks executed correctly, including the `keepCase` fix from the review.

## Critical issues

None.

## Warnings

### 1. Dockerfile production stage does not copy `proto/` — gRPC will crash on startup in Docker prod

The production stage of `Dockerfile` (lines 18–38) copies only `dist/`, `node_modules/`, and `package*.json`:

```dockerfile
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
```

At runtime, `@grpc/proto-loader` needs the raw `.proto` files. The code resolves them via `join(process.cwd(), 'proto', '...')` which becomes `/app/proto/*.proto` inside the container — but that directory is never copied into the production image. The gRPC microservice will throw `ENOENT` during `startAllMicroservices()` and crash the app.

The dev stage (`COPY . .`) includes `proto/` and is fine.

**Verdict:** This is expected — Docker changes are deferred to milestone 1.6. Flagging so it isn't forgotten. The fix is a single `COPY` line:

```dockerfile
COPY --from=builder --chown=nestjs:nodejs /app/proto ./proto
```

### 2. `live.proto` and `telemetry.proto` define services with no controllers

`LiveService` and `TelemetryService` are defined in the loaded proto files but have no corresponding `*.grpc.controller.ts`. Calling any method on these services will return a gRPC `UNIMPLEMENTED` status.

**Verdict:** Not a bug — these are Phase 3 deliverables (live session streaming). Standard gRPC behavior for unregistered methods.

## Positive notes

- **`keepCase` correctly omitted** — the default (`false`) matches ts-proto camelCase interfaces. The original plan's `keepCase: true` bug was fixed.
- **All dependencies present** — `@nestjs/microservices` (^11.1.17), `@grpc/grpc-js` (^1.14.3), `@grpc/proto-loader` (^0.8.0) are all in `package.json`.
- **Proto cross-imports resolve correctly** — `telemetry.proto` imports `live.proto` and `google/protobuf/struct.proto`; `users.proto` imports `auth.proto`. Since all files are in the same directory and loaded together, `@grpc/proto-loader` resolves sibling imports automatically. Google well-known types are bundled.
- **All 8 proto files use `package mind`** — verified. Single package name in `connectMicroservice` is correct.
- **Bootstrap ordering is correct** — `connectMicroservice` after `NestFactory.create`, `startAllMicroservices` before `app.listen`. HTTP middleware (helmet, CORS, Swagger, ValidationPipe) applies only to the Express server, not the gRPC transport.
- **`ValidationPipe` won't interfere with gRPC** — gRPC controller method parameters are ts-proto interfaces (erased to `Object` at runtime). NestJS `ValidationPipe` skips validation when metatype is `Object`, so gRPC requests pass through unaffected.
- **Env configuration consistent** — `GRPC_URL=0.0.0.0:50051` added to all three env files in a `# gRPC` section after `# WebSocket`, matching the plan.
- **6 controllers with 21 RPC methods verified** — all `@GrpcMethod`/`@GrpcStreamMethod` decorators (via ts-proto `ControllerMethods()`) match their proto service definitions. Request/response types align.

REVIEW_PASS
