# mind_mobile: proto regen + root/child client behavior

**Date:** 2026-06-28
**Source:** conversation context

## Blocking decisions
- **Mobile in-repo file specifics are deferred to a dedicated `/aif-plan` run inside `mind_mobile/`.** This note pins only the cross-repo contract (which proto to copy + exact regen command). The Dart client wiring (which widgets/services hold the root id, GoRouter navigation hooks, Drift schema deltas) is NOT pinned here and must not be guessed — it warrants its own plan in `mind_mobile`.

## Key Findings

- The mobile client is the producer that must adopt the new model: open a root on app start, address commands by `session_id`, send `client_activity_id`, stream bio with the root id, and **stop ending sessions on in-app navigation**. This is the largest consumer task and **deserves its own `/aif-plan` inside `mind_mobile`** (separate git repo).
- **Proto scope:** only `module_state.proto` changes at the proto level (adds `session_id` + `client_activity_id`, per [[05-proto-session-id-idempotency]]). `module_biometric_stream.proto` already has `session_id` (`proto/module_biometric_stream.proto:22`); bio→root is a semantic change, no proto change. `mind_mobile/proto/module_state.proto` already exists and must be overwritten from `mind_api`.

## Details

### Current state
- Mobile talks to the API via Dio + gRPC realtime client (`lib/Core/Api/`), with Drift caching some shapes. It currently runs one session at a time and (per discussion) ends the session when leaving the activity screen.

### Change
1. Copy **`module_state.proto`** (the only changed file) from `mind_api/proto/module_state.proto` into `mind_mobile/proto/` (overwrite). Regenerate Dart gRPC stubs with **`./scripts/gen_proto.sh`** (per `mind_mobile/CLAUDE.md`; note `flutter pub run build_runner build` is for Drift, NOT proto). Monorepo rule: `mind_api/proto/` is the single source of truth, consumers copy + regen, no symlinks (`/Users/max/projects/mind/CLAUDE.md:89-94`).
2. On the realtime state stream connect, treat the server-created root as the bio timeline; keep the returned `moduleSessionId` of the root.
3. `activity:start`: send `client_activity_id` (locally generated, stable across retries) and keep the returned child id.
4. `activity:pause/resume/end/stop`: send the target child's `session_id`.
5. Bio stream: send `BioSample.session_id = root.id` (not the activity id).
6. **Lifecycle:** do not send `activity:end` on screen navigation — only on explicit user finish. A meditation stays active while the user steps into a breathing exercise.
7. Sync Drift schema / DTO models if any cached realtime shape changed.

### Guards / gotchas
- Auth flow / `AuthInterceptor` untouched.
- Reconnect must resume both the root and any live children (server resumes disconnected sessions in grace).
- Pause sample policy is client-owned (existing Phase 42 behavior) — unchanged.
- Cross-project: keep DTO shapes in sync with the API (monorepo CLAUDE.md rule).

### Verify
- App open → one root; start meditation + breathing → two children sharing one bio stream.
- Navigate away from meditation → session stays active.
- Bio appears under both activities' windows in the dashboard.

## Open Questions
- Exact UX for "explicit finish" vs background suspend — define in the mobile plan.
