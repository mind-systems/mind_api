# mind_mcp: proto copy + regen + client update

**Date:** 2026-06-28
**Source:** conversation context

## Blocking decisions
- **`mind_mcp/proto/` does NOT currently contain any realtime proto.** It holds only `auth.proto` and `breath_sessions.proto` (`/Users/max/projects/mind/mind_mcp/proto/`). `module_state.proto` is absent. So this note is **a no-op for the existing MCP build** unless a deliberate decision is made to introduce realtime state control into the MCP server. Default assumption: **do nothing in `mind_mcp` for this refactor.** Confirm before doing any copy/regen here.

## Key Findings

- `mind_mcp` consumes a copy of the `.proto` contract. **Only `module_state.proto` changes at the proto level** in this refactor (it gains `session_id` on commands + `client_activity_id` idempotency token, per [[05-proto-session-id-idempotency]]). The other realtime protos are NOT changed at the proto level: `module_biometric_stream.proto` already carries `session_id` (`proto/module_biometric_stream.proto:22`) and bio→root binding is a **semantic** change only; `module_instruction_stream.proto` is untouched.
- **Caveat:** `mind_mcp/proto/` does not currently include `module_state.proto` — see Blocking decision above. The steps below apply only if a decision is made to add realtime control to MCP.

## Details

### Current state
- Per the monorepo `CLAUDE.md` (`/Users/max/projects/mind/CLAUDE.md:89-94`): "`mind_api/proto/` is the single source of truth for all `.proto` files"; "No other project may create or modify `.proto` files"; consumers "copy the updated files and regenerate stubs"; "Do not use symlinks". `mind_mcp` holds a copied proto + generated stubs.
- `mind_mcp` regen command: `npm run proto:gen` → `bash scripts/gen_proto.sh` (`/Users/max/projects/mind/mind_mcp/scripts/gen_proto.sh`), which runs `protoc` over `proto/*.proto` into `src/generated/`.

### Change (only if MCP gains realtime control — otherwise skip)
1. Copy **`module_state.proto`** (the only changed file) from `mind_api/proto/module_state.proto` into `mind_mcp/proto/`. Do not copy `module_biometric_stream.proto` / `module_instruction_stream.proto` unless MCP actually uses them — their proto bytes are unchanged anyway.
2. Regenerate stubs: `npm run proto:gen` (from `mind_mcp/`).
3. Update any place that constructs `ActivityStart/End/Stop/Pause/Resume` commands if it needs to start passing `session_id` / `client_activity_id` — otherwise leave defaults (server tolerates absence via the fallback in [[06-state-controller-concurrent-idempotency]]).

### Guards / gotchas
- Do not edit `.proto` inside `mind_mcp` — only copy from `mind_api` (monorepo rule, citation above).
- Verify `mind_mcp` builds after regen.
- Scope this work inside `mind_mcp/` (separate git repo); its own plan/roadmap if it grows.

### Verify
- `mind_mcp` builds; existing MCP tool flows unaffected.

## Open Questions
- (Largely settled — see Blocking decision.) Does any MCP tool actually drive realtime state commands today? Evidence says **no**: `mind_mcp/proto/` contains only `auth.proto` + `breath_sessions.proto`. Confirm there is no out-of-tree gRPC client before assuming a hard no-op.
