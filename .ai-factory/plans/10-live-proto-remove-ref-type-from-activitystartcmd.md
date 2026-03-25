# Plan: live.proto — remove `ref_type` from ActivityStartCmd

## Context
Remove the `ref_type` field from `ActivityStartCmd` in `live.proto`. The field was added to mirror the `activityRefType` DB column, but that column will be dropped in Phase 4 — `activity_type` alone is sufficient to identify the module. Since gRPC is not live yet (proto is contract-only, no generated stubs or gRPC controller exist), this is a safe proto-only edit with no runtime impact.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract update

- [x] **Task 1: Remove `ref_type` field and reserve its number**
  Files: `proto/live.proto`
  In the `ActivityStartCmd` message (line 50–54):
  1. Delete `optional string ref_type = 3;`
  2. Add `reserved 3;` inside the message to prevent future reuse of field number 3 (standard protobuf practice for removed fields)
  3. Update the comment block above `ActivityStartCmd` (lines 44–49): remove the two lines explaining `ref_type` / `activityRefType` mirroring. Keep the `ref_id` comment as-is.

  Result — the message should look like:
  ```protobuf
  // Maps to ActivityStartDto in src/realtime/dto/activity-start.dto.ts.
  // ref_id is the optional breath-session ID (activityRefId in the entity).
  message ActivityStartCmd {
    ActivityType activity_type = 1;
    optional string ref_id = 2;
    reserved 3;
  }
  ```
