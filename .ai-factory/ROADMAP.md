# Mind API — Roadmap

## Proto Contract Definition

> Single source of truth for all gRPC contracts. Consumers (mind_mobile, mind_mcp) copy from here and regenerate stubs.
> All files in `mind_api/proto/`. All share `syntax = "proto3"; package mind;`.

### Unary RPCs

- [ ] **proto/auth.proto** — `SendCode(email, locale?) → message`; `VerifyCode(email, code, language?) → AuthResponse(UserDto, access_token)`; `GoogleAuth(server_auth_code, language?, redirect_uri?) → AuthResponse`; `Logout() → message`; `CreateToken(name) → (token, id, name, created_at)`; `ListTokens() → repeated TokenDto(id, name, created_at, last_used_at?)`; `DeleteToken(id) → message`; `UserDto`: id, email, name, role, language; `GET /auth/google/callback` stays HTTP (browser redirect) `[api]`
- [ ] **proto/users.proto** — `UpdateProfile(name?, language?) → UserDto` `[api]`
- [ ] **proto/breath_sessions.proto** — `CreateSession(description, exercises, shared?, time_of_day?) → BreathSessionDto`; `ListSessions(page, page_size) → (data: repeated BreathSessionWithStarredDto, total, page, page_size)` auth optional — authenticated users get `is_starred`; `GetSuggestions(time_of_day) → repeated BreathSessionDto`; `BatchGetSessions(ids: repeated string, max 50) → repeated BreathSessionDto`; `GetSession(id) → BreathSessionDto`; `UpdateSession(id, description?, exercises?, shared?, time_of_day?) → BreathSessionDto`; `ReplaceSession(id, description, exercises, shared, time_of_day?) → BreathSessionDto`; `UpdateSessionSettings(id, starred) → starred`; `DeleteSession(id) → message`; messages: `BreathSessionDto(id, user_id, description, exercises, complexity, shared, time_of_day?, created_at, updated_at, deleted_at?)`; `ExerciseDto(steps, rest_duration, repeat_count)`; `StepDto(type: StepType enum INHALE/EXHALE/HOLD, duration)`; `TimeOfDay` enum: MORNING, MIDDAY, EVENING `[api]`
- [ ] **proto/stats.proto** — `GetStats() → (total_sessions, total_duration_seconds, current_streak, longest_streak, last_session_date?, max_completed_complexity)` `[api]`
- [ ] **proto/device.proto** — `Ping(installation_id, platform, os_version, locale, timezone, screen_width, screen_height, app_version, build_number, model?, manufacturer?) → empty` `[api]`
- [ ] **proto/sync.proto** (unary) — `GetChanges(after: int64, limit: int32) → oneof { SyncChangesPayload(events: repeated SyncEventDto, cursor: int64, has_more: bool), full_resync: bool }`; `SyncEventDto`: id, entity, ref_id, action, created_at `[api]`

### Streaming RPCs

- [ ] **proto/sync.proto** (streaming) — `WatchChanges(after_id?: int64) → stream ChangeEvent(repeated SyncEventDto)` `[api]`
- [ ] **proto/live.proto** — `LiveSession(stream LiveRequest) → stream LiveResponse`; `LiveRequest oneof`: `ActivityStartCmd(activity_type: ActivityType enum BREATH, ref_id?: string)`, `ActivityEndCmd`, `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd`, `PresenceCmd(state: PresenceState enum FOREGROUND/BACKGROUND)`; `LiveResponse oneof`: `SessionStateEvent(live_session_id, status: SessionStatus enum ACTIVE/DISCONNECTED/COMPLETED/ABANDONED/INTERRUPTED/RESUMED, is_paused?: bool)`, `SessionErrorEvent(code, message, timestamp: int64)` `[api]`
- [ ] **proto/telemetry.proto** — `StreamTelemetry(stream TelemetryData) → stream TelemetryAck`; `TelemetryData`: session_id, timestamp: int64, module_id (string, e.g. "breath"), instruction_type (string, module-defined, e.g. "breath_phase"), data: google.protobuf.Struct (intentionally untyped); `TelemetryAck`: session_id, received_count, dropped_count, max_samples_per_second, timestamp; error: reuse SessionErrorEvent from live.proto `[api]`

## Completed

| Milestone | Date |
|-----------|------|
