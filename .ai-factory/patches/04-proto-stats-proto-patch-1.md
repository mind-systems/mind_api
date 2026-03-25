# Patch: proto/stats.proto — review round 1

## Issue 1: `total_duration_seconds` type mismatch

**File:** `proto/stats.proto`, line 17
**Problem:** Field is typed `double` but the backing DB column is `int` and the service always produces whole numbers (`Math.floor()` in `stats.service.ts:40`). All other integer counters in the same message use `int32`. The only `double` — `max_completed_complexity` — maps to a DB `float`. Using `double` here is inconsistent and misleads consumers into expecting sub-second precision.

**Fix:**

```diff
 message GetStatsResponse {
   int32 total_sessions = 1;
-  double total_duration_seconds = 2;
+  int32 total_duration_seconds = 2;
   int32 current_streak = 3;
```

No other files need changes — this is a proto contract definition only; no generated stubs or server implementation exist yet.
