# Code Review: 01-install-grpc-packages

**Plan:** `.ai-factory/plans/01-install-grpc-packages.md`
**Branch:** `grpc`
**Risk Level:** Low

---

## Verification Results

| Check | Result |
|-------|--------|
| `npm ls` (peer deps) | Clean — no warnings |
| `npm run build` | Passes |
| `npm test` | 1 failure — **pre-existing** (`auth.service.spec.ts`, not touched by this changeset) |
| `npm run proto:gen` | **Fails** — see Issue 1 |

---

## Issues

### 1. `proto:gen` script is missing `--proto_path` — codegen fails at runtime

**File:** `package.json:27`
**Severity:** Bug (script is broken as shipped)

The current script:
```
protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./proto/generated --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true ./proto/*.proto
```

Fails with:
```
live.proto: File not found.
proto/telemetry.proto:6:1: Import "live.proto" was not found or had errors.
```

Several `.proto` files use bare imports (`import "live.proto"` in `telemetry.proto`, `import "auth.proto"` in `users.proto`). Without `-I./proto`, protoc cannot resolve these imports — it looks for `live.proto` relative to the working directory (project root), not relative to `proto/`.

**Fix:** Add `-I./proto` to the command:
```
protoc -I./proto --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./proto/generated --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true ./proto/*.proto
```

Verified: with this flag, codegen succeeds and produces all 8 expected `.ts` files plus the `google/` well-known types directory.

### 2. `proto:gen` does not create the output directory

**File:** `package.json:27`
**Severity:** Minor (first-run UX)

If `proto/generated/` does not exist (it won't on a fresh clone since it's in `.gitignore`), protoc exits with `./proto/generated/: No such file or directory`. The script should ensure the directory exists before running protoc.

**Fix:** Prepend `mkdir -p proto/generated &&` to the script:
```
"proto:gen": "mkdir -p proto/generated && protoc -I./proto --plugin=..."
```

### 3. `proto/README.md` documents a broken command

**File:** `proto/README.md:27-31`
**Severity:** Docs (follows from Issue 1)

The README's "under the hood" code block reproduces the same broken invocation without `--proto_path`. Once Issue 1 is fixed in `package.json`, the README should be updated to match — add the `-I./proto` flag to the documented command.

---

## Positive Notes

- Package selection is correct — `@grpc/grpc-js`, `@grpc/proto-loader`, `@nestjs/microservices` as runtime deps, `ts-proto` as devDependency.
- No peer dependency warnings — `@nestjs/microservices@11.1.17` satisfies all peer requirements via existing packages.
- Build passes cleanly — no TypeScript compilation regressions.
- `.gitignore` entry for `/proto/generated` is correctly placed and working.
- `DESCRIPTION.md` update is accurate and placed in the right section.
- `proto/README.md` is well-structured, written in English (correct per root CLAUDE.md rules), and covers all required sections.
- `ts-proto` options (`nestJs=true,outputServices=grpc-js,esModuleInterop=true`) are the correct combination for this stack.
