# Plan: Install gRPC packages

## Context
Add gRPC runtime and code-generation dependencies to the project, and create a proto README documenting the required `protoc` compiler version and code-gen workflow.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Dependencies

- [x] **Task 1: Install runtime gRPC packages**
  Files: `package.json`, `package-lock.json`
  Run `npm install @nestjs/microservices @grpc/grpc-js @grpc/proto-loader` inside `mind_api/`. Verify the three packages appear in `dependencies` in `package.json` and that `npm ls @nestjs/microservices @grpc/grpc-js @grpc/proto-loader` exits cleanly with no peer-dependency warnings.

- [x] **Task 2: Install ts-proto as a dev dependency**
  Files: `package.json`, `package-lock.json`
  Run `npm install --save-dev ts-proto` inside `mind_api/`. Verify it appears in `devDependencies`. This package is the protoc plugin that generates TypeScript interfaces and service stubs from `.proto` files.

- [x] **Task 3: Add proto:gen npm script**
  Files: `package.json`
  Add a `"proto:gen"` script to the `scripts` section in `package.json` that runs the `protoc` codegen command:
  ```
  "proto:gen": "protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./proto/generated --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true ./proto/*.proto"
  ```
  This keeps the codegen workflow consistent with how all other build/run/lint commands are invoked in this project — via npm scripts.

### Phase 2: Configuration & documentation

- [x] **Task 4: Add proto/generated/ to .gitignore** (depends on Task 3)
  Files: `.gitignore`
  Add `/proto/generated` to `.gitignore` under the "compiled output" section at the top of the file. Generated TypeScript stubs should not be committed — they are reproducible from `.proto` sources via `npm run proto:gen`.

- [x] **Task 5: Create proto/README.md** (depends on Task 3)
  Files: `proto/README.md`
  Create `mind_api/proto/README.md` with the following sections:
  - **Overview** — brief explanation that `proto/` is the single source of truth for all `.proto` files (reference the contract ownership rule from CLAUDE.md).
  - **Required tools** — document the minimum `protoc` version (use `protoc >= 3.21`, the first release that ships `optional` field support without requiring `syntax = "proto3"` workarounds) and the `ts-proto` npm plugin (already installed in devDependencies).
  - **Code generation command** — point to `npm run proto:gen` as the primary way to regenerate TypeScript stubs. Also document the underlying `protoc` invocation for reference: `--plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto` and `--ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true`, outputting to `proto/generated/`.
  - **Consumer workflow** — note that after any proto change, consumers (`mind_mcp`, `mind_mobile`) must copy the updated `.proto` files and regenerate their own stubs.
  - Write the file in English — `proto/` is not inside `docs/`, so the root CLAUDE.md English-only rule applies.

## Commit Plan
- **Commit 1** (after tasks 1-5): "Install gRPC packages and set up proto codegen workflow"
