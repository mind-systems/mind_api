# Meditation Poses — Service

**Date:** 2026-06-03
**Source:** conversation context

## Key Findings

- Single method `listAll()` — no user context, no filtering, no pagination.
- Always ordered by `displayOrder ASC` — the list is bounded (6 rows) and stable.
- `@InjectRepository(MeditationPose)` confined to `MeditationPosesModule`.

## Details

### File: `src/meditation-poses/meditation-poses.service.ts`

```typescript
@Injectable()
export class MeditationPosesService {
  constructor(
    @InjectRepository(MeditationPose)
    private readonly repo: Repository<MeditationPose>,
  ) {}

  listAll(): Promise<MeditationPose[]> {
    return this.repo.find({ order: { displayOrder: 'ASC' } });
  }
}
```

No error handling needed — a failed DB read throws naturally and propagates as an internal gRPC error.

### How to verify

`npm run build` compiles. Unit test: mock repo returns two rows in wrong order; `listAll()` call passes `{ order: { displayOrder: 'ASC' } }` to the repo (verify the TypeORM `find` call arguments).
