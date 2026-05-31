# Plan Review 2: Throttle the public auth REST endpoints

**Plan:** `.ai-factory/plans/36-throttle-the-public-auth-rest-endpoints.md`
**Reviewed against:** live codebase + `.ai-factory/notes/20-spec-otp-bruteforce-protection.md` §Task B + prior review (`-plan-review-1.md`)
**Risk Level:** 🟡 Medium

## Summary

The plan picked up both items from review 1: the throttler is now pinned to `@^6` (was "should pin"), and a new **Task 2** was added to handle client-IP-behind-proxy. Tasks 1 and 3 are correct and match the codebase exactly. **However, Task 2 (`trust proxy 1`) is built on a factual assumption that does not hold in this repo, and as written it can *introduce* a throttle-bypass rather than close one.** That single task needs to be reworked or dropped before implementation. Everything else is solid.

## Verified correct (no action needed)

- **Task 1 — module wiring.** `src/app.module.ts` exists with an `imports` array (lines 20–44) — correct insertion point. `@nestjs/common ^11` / `@nestjs/core ^11` confirm NestJS 11, so `@nestjs/throttler@^6` is the right major and the `forRoot([{ ttl: 60_000, limit }])` array form + ms `ttl` are valid. ✓
- **No `APP_GUARD`.** The plan keeps the guard controller-scoped, so gRPC + streaming routes stay unthrottled — the spec's central "Trap". ✓
- **Task 3 — controller path & symbols.** `src/users/controller/auth.rest.controller.ts` exports `AuthRestController` with `sendCode` (`@Post('send-code')` + `@HttpCode(HttpStatus.OK)`) and `verifyCode` (`@Post('verify-code')` + `@HttpCode`). The existing `@nestjs/common` import (`Body, Controller, HttpCode, HttpStatus, Post`) needs `UseGuards` added — exactly as the plan states. Per-route limits (3/min, 10/min) and the 60/min global default match note 20 §Task B. ✓
- **Scope.** Task-A DB lockout (plan 35) is correctly treated as already shipped and out of scope; `GoogleCallbackController` correctly left unthrottled. ✓
- **`@^6` pin.** Review-1 finding #2 is resolved. ✓

## Should Address (Medium)

### 1. Task 2's premise is wrong — there is **no reverse proxy** in the prod stack, and `trust proxy 1` opens an XFF-spoofing bypass

Task 2 justifies `app.set('trust proxy', 1)` with: *"Hop count `1` matches the single nginx/Docker reverse-proxy hop in the prod compose."* I checked the actual deployment and **there is no such hop**:

- `docker-compose.prod.yml` contains exactly two services — `mind_database_prod_host` (postgres) and `mind_api_prod`. The API publishes its HTTP port directly: `"${HOST_API_PORT}:${CONTAINER_API_PORT}"`. No nginx, no proxy service.
- `docker-compose.dev.yml`, the `Dockerfile`, and the `Makefile` contain **no** nginx / `proxy_pass` / `X-Forwarded-For` anywhere in the repo (grep-confirmed).

Why this matters — Express `trust proxy` only changes how `req.ip`/`req.ips` are derived **from the `X-Forwarded-For` header**. The `ThrottlerGuard` default tracker keys on `req.ips[0] ?? req.ip`. Two cases:

- **No proxy sets XFF (the actual situation):** With `trust proxy 1`, Express will trust the *last* value of any `X-Forwarded-For` header **the client itself sends**. Since nothing in front strips/overwrites XFF, an attacker brute-forcing the OTP just rotates `X-Forwarded-For: <random>` on each request and lands in a fresh throttle bucket every time — the per-IP limit never trips. This **defeats the exact feature this plan ships**, and it is strictly worse than leaving `trust proxy` off.
- **`trust proxy` off (current code):** `req.ips` is empty, `req.ip` is the TCP peer. For external clients hitting a directly-published Docker port on Linux (iptables DNAT), this is the real client IP and throttling works per-client. The genuine residual risk is Docker's userland `docker-proxy` masking the source as the bridge gateway — but note `trust proxy` does **not** fix that (no XFF header exists to read); it would need an infra-level fix (e.g. a real proxy that sets XFF, or `userland-proxy: false`).

So Task 2 as written either does nothing useful or actively creates a bypass, depending on whether the attacker sends XFF — and a brute-force attacker will. Recommended resolution, pick one:

- **(a) Drop Task 2.** Ship Tasks 1 + 3 only; the throttler keys on `req.ip` (TCP peer). This is the safe default for a directly-exposed app. Add a one-line note that if a real XFF-setting reverse proxy is ever introduced, `trust proxy` must be set to that proxy's hop count *at the same time*. This is the lowest-risk option given the current compose.
- **(b) Only enable `trust proxy` if a trusted XFF-setting proxy is actually confirmed in front of prod** (e.g. a host-level nginx outside this repo). If so, the plan must (i) state where that proxy lives, (ii) confirm it overwrites rather than appends client-supplied XFF, and (iii) set the hop count to match it. Without that confirmation, do not enable it.

Either way, the current justification text ("matches the single nginx/Docker reverse-proxy hop in the prod compose") is factually incorrect and must be corrected, because a future implementer will trust it.

This does not block compilation or DI — it's a security-correctness issue in the one task added to address security correctness, so it should be resolved before implementation.

## Minor / Nice-to-have

- **In-memory, per-process store.** The plan's note that limits aren't shared across replicas, with durability deferred to the Task-A DB lockout, is accurate and a reasonable conscious tradeoff. No action.
- **e2e bootstrap.** `test/app.e2e-spec.ts` boots the full `AppModule`; adding `ThrottlerModule.forRoot([...])` introduces no new required env and won't break bootstrap. A future test hammering `/auth/*` could trip a 429 — worth awareness only, no action now (Settings: Testing = no).
- **`main.ts` insertion point (only relevant if Task 2 survives).** `app.use(helmet())` is at `main.ts:77` and `NestFactory.create` at `:50` — both anchor points the plan cites exist. The `app.getHttpAdapter().getInstance().set('trust proxy', 1)` form is correct and avoids retyping the `NestFactory.create` generic, as the plan notes.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** WARN — no boundary violation. `ThrottlerModule` in `AppModule` + a controller-scoped guard fits the Modular Monolith pattern. If `trust proxy` is kept (option b), it becomes an app-wide bootstrap/IP-handling concern worth a one-line note in ARCHITECTURE.md; if dropped (option a), nothing to add.
- **Rules (`.ai-factory/RULES.md`):** PASS — no rule touched. No `!` assertions, no PII logging (minimal logging), REST routes (the gRPC `@Payload()`/`@GrpcCurrentUser()` rule does not apply).
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS — maps to the Phase 27 "Throttle the public auth REST endpoints" item and faithfully implements note 20 §Task B.

## Positive Notes

- Correctly avoids the `APP_GUARD` trap that would throttle gRPC/streaming — the biggest landmine, handled.
- Resolved review-1 finding #2 (version pin) cleanly and folded the in-memory-store caveat into the plan text.
- Tasks 1 and 3 are byte-accurate against the live controller and module — an implementer can follow them verbatim.

## Verdict

Tasks 1 and 3 are correct and ready. Task 2, added in response to review 1, rests on a reverse-proxy hop that does not exist in this repo's prod stack and, as written, would let a brute-force attacker bypass the throttle by spoofing `X-Forwarded-For`. Resolve finding #1 (drop Task 2, or enable `trust proxy` only against a confirmed trusted XFF-setting proxy and fix the justification text) before implementing.
