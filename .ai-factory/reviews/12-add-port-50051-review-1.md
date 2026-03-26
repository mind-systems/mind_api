# Code Review: Add port 50051

**Plan:** `12-add-port-50051.md`
**Files changed:** `Dockerfile`, `docker-compose.dev.yml`, `docker-compose.prod.yml`
**Files modified locally (gitignored):** `.env.dev`, `.env.prod`

---

## Verification

### Dockerfile — production stage

The `COPY --from=builder ... /app/proto ./proto` line is correctly placed after the existing COPY lines (line 30). This ensures all 8 `.proto` files referenced in `main.ts:64-73` are present at runtime. Without this, the gRPC transport would crash on startup with file-not-found errors. Correct fix.

`EXPOSE 50051` added to both `production` (line 35) and `dev` (line 55) stages alongside existing `EXPOSE 3000`. Correct.

### Docker Compose files

Both `docker-compose.dev.yml:38` and `docker-compose.prod.yml:38` add:
```yaml
- "${HOST_GRPC_PORT}:${CONTAINER_GRPC_PORT}"
```
This follows the existing pattern for HTTP (`HOST_API_PORT:CONTAINER_API_PORT`) and database (`HOST_DB_PORT:CONTAINER_DB_PORT`) port mappings. Validated with `docker compose config` — resolves correctly to `50051:50051`.

### Environment files

Both `.env.dev` and `.env.prod` add `HOST_GRPC_PORT=50051` and `CONTAINER_GRPC_PORT=50051` under the `# gRPC` section, next to the existing `GRPC_URL`. Both files are gitignored (confirmed in `.gitignore:45-46`), so these changes won't be committed — this is consistent with how all other env vars are managed in this project.

---

## Issues

None.

---

## Suggestions

### 1. `CONTAINER_GRPC_PORT` and `GRPC_URL` can drift independently

The gRPC server binds to the port embedded in `GRPC_URL` (`main.ts:58`), while Docker maps `CONTAINER_GRPC_PORT`. These are two separate values that must agree but aren't linked:

```
GRPC_URL=0.0.0.0:50051      ← server listens here
CONTAINER_GRPC_PORT=50051    ← Docker maps here
```

If someone changes `GRPC_URL` to `:50052` but forgets `CONTAINER_GRPC_PORT`, Docker maps the wrong port. This mirrors an existing pattern issue with HTTP (where `CONTAINER_API_PORT` is used both in `main.ts:105` for `app.listen()` and in Docker Compose), except the gRPC side uses a URL string rather than a standalone port variable.

A future improvement could extract the port from `GRPC_URL` in `main.ts` and use `CONTAINER_GRPC_PORT` consistently, or parse `GRPC_URL` in the compose file. Out of scope for this plan — just worth being aware of.

### 2. `proto/generated/` is copied unnecessarily into the production image

`COPY ... /app/proto ./proto` copies the entire `proto/` directory including `proto/generated/*.ts` (TypeScript source files). These are only needed at compile time — the compiled JS lives in `dist/`. The runtime only needs the raw `.proto` files. This adds negligible image size but could be tightened by copying only `*.proto` files if desired.

---

## Summary

All changes are correct and implement the plan faithfully. The Dockerfile production stage now includes the `proto/` directory required for gRPC runtime. Port mappings use parameterized env vars consistent with existing patterns. Docker Compose config validates successfully. No bugs, security issues, or correctness problems found.

REVIEW_PASS
