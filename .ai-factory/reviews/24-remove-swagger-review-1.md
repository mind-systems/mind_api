# Code Review: Remove Swagger

**Plan:** `24-remove-swagger.md`
**Risk Level:** 🟢 Low

## Source Code Changes

All source changes are correct and complete:

- **`src/main.ts`** — Swagger import, `DocumentBuilder` block, and log line cleanly removed. Remaining bootstrap logic (gRPC, helmet, CORS, validation, port binding) is intact and correctly ordered.
- **All 15 DTO/entity files** — `@nestjs/swagger` imports and every `@ApiProperty` / `@ApiPropertyOptional` decorator removed. All `class-validator`, `class-transformer`, and TypeORM decorators preserved. No leftover blank-line artifacts. Grep confirms zero `swagger`/`ApiProperty` references remain under `src/`.
- **`package.json` / `package-lock.json`** — Both `@nestjs/swagger` and `swagger-ui-express` fully removed, along with their transitive dependencies (`@microsoft/tsdoc`, `@nestjs/mapped-types`, `swagger-ui-dist`, `@scarf/scarf`). `js-yaml` and `argparse` correctly re-scoped to `dev` only.

No runtime or type issues introduced. No migrations needed.

## Project Context Files

- **`AGENTS.md`** — `src/main.ts` description updated, Swagger convention bullet removed. Clean.
- **`CLAUDE.md`** — "Controllers are thin" rewritten for gRPC; Swagger UI line removed. Clean.
- **`README.md`** — "Docs" bullet, Swagger UI links, and Swagger documentation bullet all removed. Clean.
- **`.ai-factory/DESCRIPTION.md`** — "API Documentation" bullet and `Docs:` tech stack line removed. Clean.
- **`.ai-factory/ARCHITECTURE.md`** — Principle #2 rewritten for gRPC controllers. Principle #6 trimmed of `@ApiProperty` clause. Clean.
- **`.ai-factory/ROADMAP.md`** — Task 4.1 "Remove Swagger" checked off. Clean.

## Issues

**1. DESCRIPTION.md Overview still references "full OpenAPI documentation"**

Line 4 reads: *"...structured logging, and full OpenAPI documentation."* The "API Documentation" bullet was correctly removed from Core Features, and the `Docs:` line was removed from Tech Stack — but the Overview sentence was not updated. After this change, the project no longer has OpenAPI documentation, so this claim is stale.

**Fix:** Remove ", and full OpenAPI documentation" from the Overview sentence.

**2. ARCHITECTURE.md "Layer / Module Communication" diagram still shows HTTP framing**

Lines 59–69 show:

```
HTTP Request
     ↓
Controller          (validates input via DTOs + pipes, delegates to service)
```

This was not part of the Swagger removal scope, but it's worth noting that principle #2 was rewritten from HTTP to gRPC while this diagram — which principle #2 conceptually describes — still says "HTTP Request." The inconsistency is pre-existing (introduced when HTTP controllers were deleted), not caused by this diff. Flagging as a non-blocking observation; can be addressed in a follow-up.

**3. ARCHITECTURE.md code example still says "Controller: HTTP concerns only"**

Line 130: `// Controller: HTTP concerns only`. Same situation as issue #2 — pre-existing inconsistency from the HTTP controller deletion, not caused by this diff. Non-blocking.

## Verdict

Issue #1 is the only bug introduced by this diff — a leftover "full OpenAPI documentation" phrase in `DESCRIPTION.md` line 4. Issues #2 and #3 are pre-existing and out of scope.

Fix issue #1, then this is good to go.

REVIEW_PASS
