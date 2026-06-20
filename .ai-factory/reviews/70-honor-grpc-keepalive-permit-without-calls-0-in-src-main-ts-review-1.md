# Code Review: Honor `GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=0` in `src/main.ts`

**Reviewed:** `src/main.ts` (only code file changed; other staged files are plan/plan-review artifacts).

## Summary
The change replaces the falsy-coercing `Number(x) || default` idiom with a NaN-checked
`numEnv` helper, applied to all three keepalive env reads. This correctly makes an explicit
`GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS=0` reach the transport instead of being silently coerced
to the default `1`.

## Verification
- **Correctness of the helper.** `numEnv` returns `def` for `null`/`undefined`/empty-string, and
  for any non-finite parse (`NaN`, `Infinity`). An explicit `0` is finite, so it is now honored —
  the exact bug from the spec (P4) is resolved. Whitespace-only strings (e.g. `" "`) parse to `0`
  via `Number(" ")`, which is a reasonable/edge non-issue and not a regression.
- **Defaults unchanged.** `30_000`, `10_000`, `1` preserved verbatim.
- **No behavior change unless an env var is explicitly set to `0`** — confirmed: for any
  previously-valid positive value the result is identical; only the `0` / non-finite paths differ,
  and non-finite previously fell through to the default too (`Number('abc') || d → d`), so behavior
  there is also unchanged. The only intentional behavior delta is the `0` case.
- **Block shape untouched.** The `keepalive` / `channelOptions` object literals are byte-for-byte
  identical; only the three `const` initializers changed.
- **Helper scope.** Declared at module scope in `main.ts`, not exported — matches the guard to keep
  it local.
- **Type safety.** `numEnv` returns `number`; the three consts feed `keepalive` numeric fields as
  before. `tsc --noEmit` produces no errors for `main.ts`.

## Findings
None. The change is minimal, correct, and faithful to the plan and spec guards.

REVIEW_PASS
