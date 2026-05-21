# Plan: `BciDevice` entity + `BciModule` skeleton

## Context
Create the TypeORM entity, register DTO, and `BciModule` skeleton (with stub service and controller so the project compiles) for the new per-user BCI hardware-serial resource. The full service and controller logic lands in the next two milestones.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Entity + DTO

- [x] **Task 1: Create `BciDevice` TypeORM entity**
  Files: `src/bci/entities/bci-device.entity.ts`
  Define `@Entity('bci_devices')` class matching the migration columns from `src/migrations/<timestamp>-AddBciDevicesTable.ts`. Required decorators/columns:
  - `@PrimaryGeneratedColumn('uuid') id: string`
  - `@Column('uuid', { name: 'user_id' }) userId: string`
  - `@Column() serial: string`
  - `@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date`
  - `@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date`
  - Class-level `@Index(['userId', 'serial'], { unique: true })` (mirrors the `UQ_bci_devices_user_serial` constraint from the migration).
  Do NOT add a `@ManyToOne(() => User)` relation — `BciModule` must remain isolated and not depend on the `User` entity (per the modular monolith dependency rule). The `user_id` FK with `ON DELETE CASCADE` already exists at the DB level via the migration. Follow the column-decorator style used in `src/device/entities/device.entity.ts` (explicit `name:` for snake_case mapping, `type: 'timestamptz'` on date columns).

- [x] **Task 2: Create `RegisterBciDeviceDto`**
  Files: `src/bci/dto/register-bci-device.dto.ts`
  Single-field DTO:
  ```ts
  import { IsNotEmpty, IsString } from 'class-validator';

  export class RegisterBciDeviceDto {
    @IsString()
    @IsNotEmpty()
    serial: string;
  }
  ```
  Match the formatting/style of existing DTOs under `src/breath-sessions/dto/`.

### Phase 2: Module skeleton (stubs)

- [x] **Task 3: Create stub `BciDeviceService`** (depends on Task 1)
  Files: `src/bci/bci-device.service.ts`
  Minimal compilable stub so `BciModule` can declare it as a provider. The full implementation (listForUser / register / delete with ownership checks and unique-violation handling) is the next milestone — do NOT implement those methods here. Stub:
  ```ts
  import { Injectable } from '@nestjs/common';
  import { InjectRepository } from '@nestjs/typeorm';
  import { Repository } from 'typeorm';
  import { BciDevice } from './entities/bci-device.entity';

  @Injectable()
  export class BciDeviceService {
    constructor(
      @InjectRepository(BciDevice)
      private readonly bciDevicesRepo: Repository<BciDevice>,
    ) {}
  }
  ```
  This validates that `@InjectRepository(BciDevice)` resolves correctly inside `BciModule` (the modular-monolith requirement from `CLAUDE.md`).

- [x] **Task 4: Create stub `BciDevicesGrpcController`** (depends on Task 3)
  Files: `src/bci/bci-devices.grpc.controller.ts`
  Minimal compilable stub so `BciModule` can declare it as a controller. Apply the same cross-cutting decorators that the real controller will use — this lets the next milestone focus on the RPC methods themselves. No RPC handlers yet:
  ```ts
  import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
  import { GrpcExceptionFilter } from 'src/grpc/grpc-exception.filter';
  import { GrpcAuthInterceptor } from 'src/grpc/grpc-auth.interceptor';
  import { BciDeviceService } from './bci-device.service';

  @Controller()
  @UseFilters(GrpcExceptionFilter)
  @UseInterceptors(GrpcAuthInterceptor)
  export class BciDevicesGrpcController {
    constructor(private readonly bciDeviceService: BciDeviceService) {}
  }
  ```
  Use the exact filter/interceptor import paths already used by `src/realtime/sync-stream.grpc.controller.ts` — verify before writing (search `src/grpc/` for the actual file names if the imports above don't resolve).

- [x] **Task 5: Create `BciModule`** (depends on Tasks 3, 4)
  Files: `src/bci/bci.module.ts`
  Wire the entity, controller, and service. No `exports` (no other module consumes `BciDeviceService`). Model on `src/device/device.module.ts`:
  ```ts
  import { Module } from '@nestjs/common';
  import { TypeOrmModule } from '@nestjs/typeorm';
  import { BciDevice } from './entities/bci-device.entity';
  import { BciDevicesGrpcController } from './bci-devices.grpc.controller';
  import { BciDeviceService } from './bci-device.service';

  @Module({
    imports: [TypeOrmModule.forFeature([BciDevice])],
    controllers: [BciDevicesGrpcController],
    providers: [BciDeviceService],
  })
  export class BciModule {}
  ```

- [x] **Task 6: Register `BciModule` in `AppModule`** (depends on Task 5)
  Files: `src/app.module.ts`
  Add `import { BciModule } from './bci/bci.module';` next to the other feature-module imports and place `BciModule` in the `imports` array of `@Module(...)` next to `BreathSessionsModule` (i.e. on the line directly following `BreathSessionsModule,`). Do not change any other module's position.

### Phase 3: Verification

- [x] **Task 7: Verify the project compiles** (depends on Task 6)
  Files: (no file changes)
  From `mind_api/`, run:
  - `npm run build` — confirm TypeScript compiles with the new module wired in.
  - `npm run lint` — confirm no lint errors in the new files.
  No runtime verification needed — the RPC methods are added in the next milestone.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add BciDevice entity and RegisterBciDeviceDto"
- **Commit 2** (after tasks 3-7): "Add BciModule skeleton and register in AppModule"
