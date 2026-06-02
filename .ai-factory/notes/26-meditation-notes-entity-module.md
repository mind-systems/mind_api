# Meditation Notes — Entity and Module Skeleton

**Date:** 2026-06-02
**Source:** conversation context

## Key Findings

- `MeditationNote` entity mirrors the migration schema; `sessionId` is `string | null`, `poseName` is a plain varchar.
- `MeditationNotesModule` follows the pattern of `NfbCalibrationModule` (TypeORM forFeature, controller, service, no exports).
- Register `MeditationNotesModule` in `AppModule` alongside existing feature modules.

## Details

### Entity: `src/meditation-notes/entities/meditation-note.entity.ts`

```typescript
@Entity('meditation_notes')
export class MeditationNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'session_id', nullable: true })
  sessionId: string | null;

  @Column({ name: 'pose_name' })
  poseName: string;

  @Column({ name: 'note_text', type: 'text' })
  noteText: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

### Module: `src/meditation-notes/meditation-notes.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([MeditationNote])],
  controllers: [MeditationNotesGrpcController],
  providers: [MeditationNotesService],
})
export class MeditationNotesModule {}
```

Register in `AppModule.imports` next to `NfbCalibrationModule`.

### Guard conditions

- `@InjectRepository(MeditationNote)` must only be used inside `MeditationNotesModule` (modular monolith rule from CLAUDE.md).
- No `exports` array — no other module needs `MeditationNotesService`.
- Controller and service stubs can be empty at this stage; the point is a compiling module skeleton.

## How to verify

`npm run build` compiles without errors. `AppModule` imports list includes `MeditationNotesModule`.
