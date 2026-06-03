# Meditation Poses — Entity and Module Skeleton

**Date:** 2026-06-03
**Source:** conversation context

## Key Findings

- Entity has exactly three columns: `id`, `slug`, `displayOrder` — no timestamps, no user FK.
- Module pattern mirrors `src/meditation-notes/meditation-notes.module.ts`.
- `@InjectRepository(MeditationPose)` must stay confined to `MeditationPosesModule`.
- Register in `AppModule` next to `MeditationNotesModule`.

## Details

### Entity: `src/meditation-poses/entities/meditation-pose.entity.ts`

```typescript
@Entity('meditation_poses')
export class MeditationPose {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string;

  @Column({ name: 'display_order', type: 'smallint' })
  displayOrder: number;
}
```

No `@CreateDateColumn`, no `@UpdateDateColumn`, no `@DeleteDateColumn` — table is immutable reference data.

### Module: `src/meditation-poses/meditation-poses.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([MeditationPose])],
  controllers: [MeditationPosesGrpcController],
  providers: [MeditationPosesService],
})
export class MeditationPosesModule {}
```

No `exports` — nothing in other modules needs `MeditationPosesService`.

### AppModule registration

Add `MeditationPosesModule` to `AppModule.imports` next to `MeditationNotesModule`.

### How to verify

`npm run build` compiles without errors; `MeditationPosesModule` appears in the NestJS startup log.
