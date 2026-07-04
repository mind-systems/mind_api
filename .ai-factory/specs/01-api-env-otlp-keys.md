# Add OTLP env keys to .env.staging / .env.prod

**Date:** 2026-07-04
**Source:** conversation context

## Key Findings

- `src/main.ts:28-33` already resolved `LOG_DESTINATION`/`OTLP_ENDPOINT` from `process.env`, defaulting to `file` / local Loki — code was already build/deploy-agnostic.
- Only `.env` (local) set these two keys; `.env.staging`/`.env.prod` defined neither, so those deploys silently stayed `file`-only.
- The staging cloud observe backend is now live and verified (see `digital_ocean/.ai-factory/handoffs/03-observe-staging-deploy-endpoints.md` for the deployment details — its live URLs are operational values, not repeated here).
- `init(...)` in `main.ts` passed no `headers`, but the write-proxy in front of the cloud endpoint requires `Authorization: Bearer <token>` on every write (unlike the local-only-to-Loki path, which needs no auth). `init()`'s signature already accepts `headers?: Record<string,string>`.

## Details

### Current state → target change (shipped 2026-07-04)

- `src/main.ts`: added `const otlpAuthToken = process.env.OTLP_AUTH_TOKEN;` and threaded it into the existing `init(...)` call as `headers: otlpAuthToken ? { Authorization: 'Bearer ' + otlpAuthToken } : undefined`. No other change to the `logToFile`/transports wiring.
- `.env` (local, gitignored) and `.env.staging` (gitignored) now carry the real `OTLP_ENDPOINT` + `OTLP_AUTH_TOKEN` values — **local routes through the local `observe-write-proxy`, not straight to Loki, matching the same auth model as staging.** Actual values live only in those gitignored files (never in this spec, never in `.env.example`) — read them directly if you need the current endpoint/token.
- `.env.prod` is untouched (prod stack not deployed — separate future task).

### Guards

- Don't put real endpoints or tokens in `.env.example`, this spec, or the roadmap contract line — those are committed; only the gitignored `.env`/`.env.staging`/`.env.prod` may hold real values.
- Don't invent/mint a token from a spec-writing session — tokens are minted via the write-proxy's admin GUI (Grafana-login gated) and copied directly into the gitignored env file.
- `.env.prod` stays a placeholder until the prod stack exists.

## Verify

- Local path: confirm via `observe-logs` skill (`since-restart mind_api --project mind`) or Grafana Explore against the local backend.
- Staging path: confirm via Grafana Explore against the staging backend (`{project="mind", service_name="mind_api"}`).
- A missing/invalid token degrades silently (401 dropped by the SDK, no crash) — confirmed behavior, not just a design intent.
