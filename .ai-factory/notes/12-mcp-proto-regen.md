# mind_mcp: proto copy + regen + client update

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- `mind_mcp` consumes a copy of the `.proto` contract. After the state-proto change ([[05-proto-session-id-idempotency]]) it must copy the updated proto from `mind_api/proto/`, regenerate its stubs, and adjust any client code touching the changed messages.
- Changes are additive optional fields, so client impact is minimal — likely compile-clean.

## Details

### Current state
- Per the monorepo CLAUDE.md, `mind_api/proto/` is the single source of truth; `mind_mcp` holds a copied proto + generated stubs. No symlinks.

### Change
1. Copy `module_state.proto` (and any other changed `.proto`) from `mind_api/proto/` into the `mind_mcp` proto directory.
2. Regenerate stubs (mind_mcp's proto:gen).
3. Update any place that constructs `ActivityStart/End/Stop/Pause/Resume` commands if it needs to start passing `session_id` / `client_activity_id` — otherwise leave defaults (server tolerates absence via the fallback in [[06-state-controller-concurrent-idempotency]]).

### Guards / gotchas
- Do not edit `.proto` inside `mind_mcp` — only copy from `mind_api`.
- Verify `mind_mcp` builds after regen.
- Scope this work inside `mind_mcp/` (separate git repo); its own plan/roadmap if it grows.

### Verify
- `mind_mcp` builds; existing MCP tool flows unaffected.

## Open Questions
- Does any MCP tool actually drive realtime state commands today, or only REST/PAT flows? If the latter, this may be a no-op beyond keeping proto in sync.
