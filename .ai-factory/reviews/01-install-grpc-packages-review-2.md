# Code Review: 01-install-grpc-packages (Review 2)

**Plan:** `.ai-factory/plans/01-install-grpc-packages.md`
**Branch:** `grpc`
**Risk Level:** Low

---

## Verification Results

| Check | Result |
|-------|--------|
| `npm ls` (peer deps) | Clean — no warnings, all resolved correctly |
| `npm run build` | Passes |
| `npm run proto:gen` | **Fails** — Issues 1 & 2 from Review 1 are still present |

---

## Unresolved Issues from Review 1

### 1. `proto:gen` script is missing `--proto_path` — codegen fails at runtime

**File:** `package.json:27`
**Severity:** Bug (script is broken as shipped)

Still not fixed. The script:
```
protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./proto/generated --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true ./proto/*.proto
```

Fails with:
```
live.proto: File not found.
proto/telemetry.proto:6:1: Import "live.proto" was not found or had errors.
```

Proto files use bare imports (`import "live.proto"` in `telemetry.proto`, `import "auth.proto"` in `users.proto`). Without `-I./proto`, protoc resolves imports relative to the working directory (project root), not relative to the `proto/` directory where the files live.

**Fix:** Add `-I./proto` to the command:
```
"proto:gen": "mkdir -p proto/generated && protoc -I./proto --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./proto/generated --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true ./proto/*.proto"
```

Verified in Review 1: with this flag (and `mkdir -p`), codegen succeeds and produces all 8 expected `.ts` files.

### 2. `proto:gen` does not create the output directory

**File:** `package.json:27`
**Severity:** Minor (first-run UX)

Still not fixed. On a fresh clone, `proto/generated/` won't exist (it's gitignored), so protoc exits with `No such file or directory`.

**Fix:** Prepend `mkdir -p proto/generated &&` to the script (included in the combined fix above).

### 3. `proto/README.md` documents the broken command

**File:** `proto/README.md:27-31`
**Severity:** Docs (follows from Issue 1)

Still not fixed. The README's "under the hood" code block reproduces the same invocation without `-I./proto`. Once the script is fixed, the README must match.

---

## No New Issues Found

Beyond the three unresolved items above, the rest of the changeset is correct:

- **Package selection** — `@grpc/grpc-js` + `@grpc/proto-loader` + `@nestjs/microservices` as runtime deps, `ts-proto` as devDependency. Correct and complete.
- **Peer dependencies** — `@nestjs/microservices@11.1.17` peer-requires `@nestjs/common@^11`, `@nestjs/core@^11`, `rxjs@^7`, `reflect-metadata@^0.1.12 || ^0.2.0` — all satisfied by existing packages. `@grpc/grpc-js` is an optional peer of `@nestjs/microservices` and is correctly installed.
- **Build** — TypeScript compilation passes with no regressions.
- **`.gitignore`** — `/proto/generated` correctly placed under "compiled output".
- **`DESCRIPTION.md`** — gRPC line added in the right section, accurate content.
- **`proto/README.md`** — Written in English (correct per root CLAUDE.md), well-structured, all required sections present.
- **`ts-proto` options** — `nestJs=true,outputServices=grpc-js,esModuleInterop=true` is the correct combination for this NestJS + `@grpc/grpc-js` stack.
