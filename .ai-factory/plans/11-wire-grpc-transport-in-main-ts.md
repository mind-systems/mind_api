# Plan: Wire gRPC transport in main.ts

## Context
Enable the gRPC microservice transport alongside the existing HTTP server so both transports run simultaneously during the transition period. All gRPC controllers, interceptors, and exception filters are already implemented and registered in their modules — only the transport bootstrap in `main.ts` is missing.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Environment configuration

- [x] **Task 1: Add `GRPC_URL` env variable to all environment files**
  Files: `.env`, `.env.dev`, `.env.prod`
  Add `GRPC_URL=0.0.0.0:50051` to all three files, in a `# gRPC` section placed after the `# WebSocket` block. Use the same value across all environments — the port mapping differences are handled at the Docker layer (milestone 1.6).

### Phase 2: Bootstrap gRPC microservice

- [x] **Task 2: Wire `connectMicroservice` and `startAllMicroservices` in main.ts** (depends on Task 1)
  Files: `src/main.ts`
  After `app.useWebSocketAdapter(new IoAdapter(app))` (line 54) and before the security/swagger/validation block, add:
  1. Import `MicroserviceOptions`, `Transport` from `@nestjs/microservices` and `join` from `path`.
  2. Read the gRPC URL from `process.env.GRPC_URL` with fallback to `'0.0.0.0:50051'`.
  3. Call `app.connectMicroservice<MicroserviceOptions>()` with:
     - `transport: Transport.GRPC`
     - `options.url` — the gRPC URL from env
     - `options.package` — `'mind'` (all 8 proto files use `package mind`)
     - `options.protoPath` — array of all 8 proto files using `join(process.cwd(), 'proto', '<file>.proto')`:
       `auth.proto`, `breath_sessions.proto`, `device.proto`, `live.proto`, `stats.proto`, `sync.proto`, `telemetry.proto`, `users.proto`
     - Do **not** set `options.loader.keepCase` — the default (`false`) converts proto snake_case field names to camelCase at runtime, which matches the ts-proto generated TypeScript interfaces used by all gRPC controllers (e.g. `installationId`, `serverAuthCode`, `timeOfDay`). Setting `keepCase: true` would deliver snake_case keys and silently break every multi-word field access.
  4. Call `await app.startAllMicroservices()` immediately before the existing `await app.listen(port)` line — both transports start up, HTTP and gRPC run simultaneously.
  5. Add a `Logger.log` line after `startAllMicroservices` reporting the gRPC URL (follow the existing pattern: `Logger.log(\`gRPC server running on: ${grpcUrl}\`)`).
