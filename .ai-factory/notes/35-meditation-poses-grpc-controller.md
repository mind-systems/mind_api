# Meditation Poses — gRPC Controller

**Date:** 2026-06-03
**Source:** conversation context

## Key Findings

- Single `ListPoses` RPC handler — auth-required (throw `UNAUTHENTICATED` if user is null).
- No Date fields to convert — entity has no timestamps.
- `displayOrder: number` maps to proto `display_order: int32` via camelCase key.
- Modelled on `src/meditation-notes/meditation-notes.grpc.controller.ts`.

## Details

### File: `src/meditation-poses/meditation-poses.grpc.controller.ts`

```typescript
@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class MeditationPosesGrpcController {
  constructor(private readonly svc: MeditationPosesService) {}

  @GrpcMethod('MeditationPosesService', 'listPoses')
  async listPoses(
    _request: ListMeditationPosesRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ListMeditationPosesResponse> {
    if (!user) {
      throw new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' });
    }
    const poses = await this.svc.listAll();
    return {
      poses: poses.map(p => ({
        id: p.id,
        slug: p.slug,
        displayOrder: p.displayOrder,
      })),
    };
  }
}
```

### Imports

- `RpcException` from `@nestjs/microservices`
- `status as GrpcStatus` from `@grpc/grpc-js`
- `GrpcExceptionFilter`, `GrpcAuthInterceptor` from `src/grpc/`
- `GrpcCurrentUser` from `src/grpc/decorators/grpc-current-user.decorator.ts`
- `JwtPayload` from `src/users/interfaces/auth.interface`
- Generated types from `proto/generated/meditation_poses`

### How to verify

`npm run build` compiles. Integration: connect a gRPC client with a valid JWT → `ListPoses({})` returns 6 poses ordered by `displayOrder`.
