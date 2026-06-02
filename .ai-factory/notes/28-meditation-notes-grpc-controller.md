# Meditation Notes — gRPC Controller

**Date:** 2026-06-02
**Source:** conversation context

## Key Findings

- Three `@GrpcMethod` handlers: `createNote`, `updateNote`, `listNotes`; all require authenticated user.
- `updateNote` takes `note_id` + `note_text` only — ownership check in service.
- Entity → proto mapping: `Date` → `.toISOString()` (ISO-8601 strings), `null sessionId` → empty string, no `userId` field in response.

## Details

### File: `src/meditation-notes/meditation-notes.grpc.controller.ts`

```typescript
@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class MeditationNotesGrpcController {
  constructor(private readonly svc: MeditationNotesService) {}

  @GrpcMethod('MeditationNotesService', 'createNote')
  async createNote(
    req: CreateNoteRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<MeditationNote> {
    if (!user) {
      throw new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' });
    }
    const note = await this.svc.create(user.sub, req.sessionId, req.poseName, req.noteText);
    return toProto(note);
  }

  @GrpcMethod('MeditationNotesService', 'updateNote')
  async updateNote(
    req: UpdateNoteRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<MeditationNote> {
    if (!user) {
      throw new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' });
    }
    const note = await this.svc.updateText(req.noteId, user.sub, req.noteText);
    return toProto(note);
  }

  @GrpcMethod('MeditationNotesService', 'listNotes')
  async listNotes(
    req: ListNotesRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ListNotesResponse> {
    if (!user) {
      throw new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' });
    }
    const { notes, nextPageToken } = await this.svc.list(user.sub, req.pageSize, req.pageToken);
    return { notes: notes.map(toProto), nextPageToken };
  }
}

function toProto(note: MeditationNoteEntity): MeditationNote {
  return {
    id: note.id,
    sessionId: note.sessionId ?? '',      // null → empty string (proto3 default)
    poseName: note.poseName,
    noteText: note.noteText,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    // userId intentionally omitted — matches BciDevice / NfbCalibrationRecord convention
  };
}
```

### Imports

- `RpcException` from `@nestjs/microservices`
- `status as GrpcStatus` from `@grpc/grpc-js`
- `GrpcExceptionFilter`, `GrpcAuthInterceptor` from `src/grpc/`
- `GrpcCurrentUser` from `src/grpc/decorators/grpc-current-user.decorator.ts`
- `JwtPayload` from `src/users/interfaces/auth.interface`
- Generated proto types from `proto/generated/meditation_notes`

### Guard conditions

- `@GrpcCurrentUser()` is the second parameter after the request body — same pattern as all other gRPC controllers.
- `null sessionId` → empty string in proto (proto3 convention for absent strings).
- Timestamps → `.toISOString()` — consistent with `BciDevicesGrpcController` and `NfbCalibrationGrpcController`.
- `userId` is NOT returned in the response message (client knows its own ID; omit for consistency with other resources).

## How to verify

`npm run build` compiles. Manual test via grpcurl: `CreateNote` with valid JWT + real session ID returns a `MeditationNote` with ISO-8601 `created_at`/`updated_at`. `UpdateNote` with a different user's note UUID returns `PERMISSION_DENIED`.
