# Plan: MeditationNotesGrpcController

## Context
Wire the already-implemented `MeditationNotesService` to gRPC by filling in the empty `MeditationNotesGrpcController` with three handlers (`createNote`, `updateNote`, `listNotes`), add the entity→proto mapper, and register the proto with the gRPC server so the service is reachable.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Add `toProtoMeditationNote` mapper**
  Files: `src/grpc/grpc-mappers.ts`
  Add a mapper function following the existing `toProtoNfbCalibrationRecord` / `toProtoBciDevice` convention (shared mappers live in this file, not inline in the controller — same as the `NfbCalibrationGrpcController` this milestone is modelled on).
  - Import the entity type: `import type { MeditationNote } from '../meditation-notes/entities/meditation-note.entity';`
  - Import the proto type aliased to avoid the name clash with the entity: `import type { MeditationNote as MeditationNoteProto } from '../../proto/generated/meditation_notes';`
  - Signature: `export function toProtoMeditationNote(entity: MeditationNote): MeditationNoteProto`
  - Mapping rules (per spec `.ai-factory/notes/28-meditation-notes-grpc-controller.md`):
    - `id: entity.id`
    - `sessionId: entity.sessionId ?? ''` — `null` → empty string (proto3 default)
    - `poseName: entity.poseName`
    - `noteText: entity.noteText`
    - `createdAt: entity.createdAt.toISOString()`
    - `updatedAt: entity.updatedAt.toISOString()`
    - **no `userId` field** — intentionally omitted, matching `BciDevice` / `NfbCalibrationRecord`.
  - Do NOT use the non-null assertion operator (`!`) anywhere — use `??` as shown (project rule).

- [x] **Task 2: Implement the three gRPC handlers** (depends on Task 1)
  Files: `src/meditation-notes/meditation-notes.grpc.controller.ts`
  Fill in the currently-empty controller. Keep the existing class decorators (`@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`) and the injected `meditationNotesService`. Model the handlers exactly on `NfbCalibrationGrpcController`.
  - Imports to add:
    - `GrpcMethod, Payload, RpcException` from `@nestjs/microservices`
    - `status as GrpcStatus` from `@grpc/grpc-js`
    - `CreateNoteRequest, UpdateNoteRequest, ListNotesRequest, ListNotesResponse, MeditationNote as MeditationNoteProto` from `../../proto/generated/meditation_notes`
    - `GrpcCurrentUser` from `../grpc/decorators/grpc-current-user.decorator`
    - `import type { JwtPayload } from '../users/interfaces/auth.interface'`
    - `toProtoMeditationNote` from `../grpc/grpc-mappers`
  - **Project rule (mandatory):** every handler that uses `@GrpcCurrentUser()` must also decorate the request parameter with `@Payload()`, otherwise the request is `undefined` at runtime. The request param comes first, `@GrpcCurrentUser()` second — matching the NFB reference.
  - In each handler, if `user` is `null`, throw `new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' })`.
  - `createNote(@Payload() req: CreateNoteRequest, @GrpcCurrentUser() user: JwtPayload | null): Promise<MeditationNoteProto>`
    - Call `this.meditationNotesService.create(user.sub, req.sessionId || null, req.poseName, req.noteText)`.
    - **Note:** convert the empty-string `req.sessionId` to `null` (`req.sessionId || null`). The `session_id` DB column is `uuid`, so passing `''` would raise an invalid-uuid error that the service does not catch; `null` is the correct "no session" value.
    - Return `toProtoMeditationNote(note)`.
  - `updateNote(@Payload() req: UpdateNoteRequest, @GrpcCurrentUser() user: JwtPayload | null): Promise<MeditationNoteProto>`
    - Call `this.meditationNotesService.updateText(req.noteId, user.sub, req.noteText)` — ownership check (PERMISSION_DENIED) and NOT_FOUND are handled inside the service.
    - Return `toProtoMeditationNote(note)`.
  - `listNotes(@Payload() req: ListNotesRequest, @GrpcCurrentUser() user: JwtPayload | null): Promise<ListNotesResponse>`
    - Call `this.meditationNotesService.list(user.sub, req.pageSize, req.pageToken)`.
    - Return `{ notes: notes.map(toProtoMeditationNote), nextPageToken }`.
  - Bind each handler with `@GrpcMethod('MeditationNotesService', '<methodName>')`.
  - Do NOT use the non-null assertion operator (`!`).

- [x] **Task 3: Register `meditation_notes.proto` with the gRPC server** (depends on Task 2)
  Files: `src/main.ts`
  The gRPC microservice `protoPath` array (around line 60-72) does not yet include `meditation_notes.proto`, so `MeditationNotesService` would not be exposed even with the controller wired. Add `join(process.cwd(), 'proto', 'meditation_notes.proto'),` to the `protoPath` array alongside the other proto entries (e.g. after `nfb_calibration.proto`).

## Verification
`npm run build` compiles cleanly. The gRPC server exposes `MeditationNotesService`; a `CreateNote` call with a valid JWT returns a `MeditationNote` with ISO-8601 `created_at`/`updated_at` and no `user_id`, and `UpdateNote` against another user's note returns `PERMISSION_DENIED`.
