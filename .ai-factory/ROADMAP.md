# Mind API — Roadmap

## In Progress

- [x] **Personal Access Tokens** — create/revoke long-lived tokens for CLI/MCP access; `personal_access_tokens` table (hashed); accepted by JwtAuthGuard alongside regular JWTs; token format uses `pat_` prefix so the guard can distinguish PATs from JWTs without attempting JWT verification first; `POST /auth/tokens` generates a random secret, stores SHA-256 hash, returns the raw value once; endpoints: `POST /auth/tokens`, `GET /auth/tokens`, `DELETE /auth/tokens/:id`
- [x] **Exercise Time-of-Day Field** — add nullable `timeOfDay` enum column (`morning | midday | evening`) to `breath_sessions`; migration, entity, DTOs, seed values
- [x] **Suggestions Endpoint** — `GET /breath_sessions/suggestions?timeOfDay=X`; returns random 3–4 of the user's sessions matching the requested time slot; client always sends morning/midday/evening (night maps to morning on the client side)
- [x] **User Complexity Tracking** — add `maxCompletedComplexity` column to `user_stats`; update on session completion with easeIn: `newMax = currentMax + (completed - currentMax) * factor` to prevent spikes from accidental hard sessions
- [ ] **Smart Suggestions Filtering** — suggestions endpoint filters by `complexity ≤ maxCompletedComplexity + threshold`; depends on User Complexity Tracking
