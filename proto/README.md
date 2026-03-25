# Proto

## Overview

The `proto/` directory is the **single source of truth** for all `.proto` files in the project. No other project may create or modify `.proto` files — any contract change starts here, is implemented in `mind_api`, and then propagated to consumers.

## Required tools

| Tool | Minimum version | Notes |
|------|-----------------|-------|
| `protoc` | 3.21 | First release with full `optional` field support in proto3 without workarounds |
| `ts-proto` | installed via npm | `devDependencies` — protoc plugin that generates TypeScript interfaces and NestJS service stubs |

Install `protoc` via your system package manager (e.g. `brew install protobuf` on macOS) or download a release from [github.com/protocolbuffers/protobuf/releases](https://github.com/protocolbuffers/protobuf/releases).

## Code generation

Run the npm script to regenerate TypeScript stubs from all `.proto` files:

```bash
npm run proto:gen
```

This executes the following `protoc` invocation under the hood:

```
mkdir -p proto/generated && protoc \
  -I./proto \
  --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
  --ts_proto_out=./proto/generated \
  --ts_proto_opt=nestJs=true,outputServices=grpc-js,esModuleInterop=true \
  ./proto/*.proto
```

Key options:
- `nestJs=true` — generates NestJS-compatible decorators and service interfaces
- `outputServices=grpc-js` — emits `@grpc/grpc-js`-compatible service definitions
- `esModuleInterop=true` — enables default import compatibility
- Output goes to `proto/generated/`, which is excluded from version control (`.gitignore`)

## Consumer workflow

After any `.proto` change in this directory:

1. Implement the change in `mind_api`.
2. Copy the updated `.proto` files to each consumer (`mind_mcp`, `mind_mobile`).
3. Each consumer regenerates its own stubs using its own toolchain.

Do not use symlinks — they break when repositories are cloned independently.
