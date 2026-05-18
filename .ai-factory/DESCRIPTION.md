# Project: Mind Awake API

## Overview
Mind Awake API is a NestJS-based gRPC backend for a mindfulness breathing application. It exposes all business logic over gRPC (port 50051) with a single HTTP relay endpoint for Google OAuth browser flow. Features: passwordless email-code authentication, Google Sign-In, JWT session management, breath session CRUD, real-time activity tracking via bidi-streaming gRPC, sync change events, and user statistics.

## Core Features
- **Authentication:** Passwordless OTP via email (`rpc SendCode` + `rpc VerifyCode` → JWT); Google Sign-In (`rpc GoogleAuth`); Personal Access Tokens (`rpc CreateToken / ListTokens / DeleteToken`)
- **JWT Security:** `GrpcAuthInterceptor` validates token + `user_sessions` table on every gRPC call; session invalidated on `rpc Logout`; scheduled cleanup of expired sessions
- **Email Delivery:** Resend integration with HTML template (magic link + manual code, 15-min TTL)
- **Breath Sessions:** Full CRUD (`rpc CreateSession / GetSession / ListSessions / UpdateSession / ReplaceSession / DeleteSession`) with owner-based access control and public shared-link support
- **Real-time:** Bidi-streaming `ModuleStateService` (activity lifecycle) + `ModuleInstructionStreamService` (instruction samples); server-streaming `WatchChanges` (sync push)
- **Logging:** Winston with daily log rotation to `logs/` directory (combined + error streams)
- **Infrastructure:** Multi-stage Docker builds (dev/prod), Makefile automation, Jenkins CI pipelines

## Tech Stack
- **Language:** TypeScript 5.7
- **Runtime:** Node.js
- **Framework:** NestJS 11
- **Database:** PostgreSQL
- **ORM:** TypeORM 0.3 (migration-based, no synchronize in production)
- **Auth:** `@nestjs/jwt` + `passport-jwt` (passwordless OTP flow)
- **Mail:** Resend SDK
- **Validation:** `class-validator` + `class-transformer`
- **HTTP Security:** Helmet
- **gRPC:** `@nestjs/microservices` + `@grpc/grpc-js` + `@grpc/proto-loader` (runtime); `ts-proto` (codegen, devDependency)
- **Events:** `@nestjs/event-emitter` (internal event bus)
- **Scheduling:** `@nestjs/schedule` (Cron for expired sessions + auth codes cleanup)
- **Logging:** Winston + `nest-winston` + `winston-daily-rotate-file`
- **Testing:** Jest + ts-jest + supertest
- **Containerization:** Docker (multi-stage), docker-compose (dev/prod variants)
- **CI:** Jenkins (Jenkinsfile + Jenkinsfile.dev)

## Architecture
See `.ai-factory/ARCHITECTURE.md` for detailed architecture guidelines.
Pattern: Modular Monolith

## Non-Functional Requirements
- Logging: Configurable via `LOG_LEVEL` env var; file rotation daily
- Error handling: Normalized error responses via NestJS exception filters
- Security: Helmet headers, strict Bearer guard, OTP codes hashed (SHA-256, never stored plaintext)
- Ports: Dev API on `3002` (Docker), `3000` (local); DB on `5432`
