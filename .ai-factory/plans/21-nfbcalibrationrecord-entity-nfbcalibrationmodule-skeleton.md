# Plan: NfbCalibrationRecord entity + NfbCalibrationModule skeleton

## Context
Create the TypeORM entity that maps to the `nfb_calibration_records` table (created by the prior migration `AddNfbCalibrationRecordsTable`) and a NestJS feature module skeleton wired into `AppModule`. This is the foundation for the upcoming `NfbCalibrationService` and `NfbCalibrationGrpcController` tasks; this milestone delivers only the entity + module wiring (controller and service files are stubbed/declared but their bodies belong to the next milestones).

Reference pattern: `src/bci/entities/bci-device.entity.ts` and `src/bci/bci.module.ts` — same modular monolith shape (TypeORM feature import, `AuthModule` for `JwtAuthGuard`/`@GrpcCurrentUser`, single controller + service).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Entity

- [x] **Task 1: Create `NfbCalibrationRecord` TypeORM entity**
  Files: `src/nfb-calibration/entities/nfb-calibration-record.entity.ts`
  Create the entity file with the following definition:
  - Imports: `Entity`, `PrimaryGeneratedColumn`, `Column`, `Index`, `CreateDateColumn` from `typeorm`.
  - Class-level decorators: `@Entity('nfb_calibration_records')` and `@Index(['userId', 'deviceSerial'])` (non-unique — every calibration run is its own historical row, matching the migration).
  - Columns (match the migration `AddNfbCalibrationRecordsTable` exactly):
    - `@PrimaryGeneratedColumn('uuid') id: string;`
    - `@Column('uuid', { name: 'user_id' }) userId: string;` — use `'uuid'` column type to mirror `BciDevice.userId` and the migration's `user_id uuid` column.
    - `@Column({ name: 'device_serial' }) deviceSerial: string;` — explicit `name` so the column maps to `device_serial` (snake_case), since TypeORM does not automatically convert camelCase property names to snake_case here.
    - `@Column({ name: 'calibrated_at', type: 'timestamptz' }) calibratedAt: Date;`
    - `@Column({ name: 'is_valid' }) isValid: boolean;`
    - `@Column({ name: 'fail_reason', type: 'varchar', nullable: true }) failReason: string | null;`
    - Seven numeric columns (`type: 'float'`, snake_case `name`), one each for:
      - `individualFrequency` → `individual_frequency`
      - `individualPeakFrequencyPower` → `individual_peak_frequency_power`
      - `individualPeakFrequencySuppression` → `individual_peak_frequency_suppression`
      - `individualBandwidth` → `individual_bandwidth`
      - `individualNormalizedPower` → `individual_normalized_power`
      - `lowerFrequency` → `lower_frequency`
      - `upperFrequency` → `upper_frequency`
    - `@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;`
  - Do not add `@UpdateDateColumn` — records are append-only and immutable.
  - Do not use the non-null assertion operator (`!`) on class fields; follow the `BciDevice` style — plain class properties without `!` are used in this project.

### Phase 2: Module wiring

- [x] **Task 2: Create stub `NfbCalibrationService`** (depends on Task 1)
  Files: `src/nfb-calibration/nfb-calibration.service.ts`
  Create a minimal `@Injectable()` `NfbCalibrationService` class that injects the repository so the module can register it as a provider. The full method implementations (`record`, `list`) are owned by the next milestone — this milestone provides only the class scaffold:
  - `import { Injectable } from '@nestjs/common';`
  - `import { InjectRepository } from '@nestjs/typeorm';`
  - `import { Repository } from 'typeorm';`
  - `import { NfbCalibrationRecord } from './entities/nfb-calibration-record.entity';`
  - Constructor injects `@InjectRepository(NfbCalibrationRecord) private readonly repo: Repository<NfbCalibrationRecord>` (constructor body empty).
  - No methods yet — leave the class body otherwise empty so that the next milestone fills in `record()` and `list()`.

- [x] **Task 3: Create stub `NfbCalibrationGrpcController`** (depends on Task 1)
  Files: `src/nfb-calibration/nfb-calibration.grpc.controller.ts`
  Create a minimal `@Controller()`-decorated `NfbCalibrationGrpcController` class so the module has a controller to register. The gRPC method bodies are owned by the later milestone — this milestone provides only the class scaffold:
  - `import { Controller } from '@nestjs/common';`
  - `import { NfbCalibrationService } from './nfb-calibration.service';`
  - `@Controller()` decorator on an empty class with a constructor that injects `private readonly service: NfbCalibrationService` (no methods yet).
  - Do not import or apply `GrpcExceptionFilter`/`GrpcAuthInterceptor` here — those wiring decisions belong to the controller-implementation milestone (Phase 20, task `NfbCalibrationGrpcController`).

- [x] **Task 4: Create `NfbCalibrationModule`** (depends on Tasks 1, 2, 3)
  Files: `src/nfb-calibration/nfb-calibration.module.ts`
  Mirror `src/bci/bci.module.ts`:
  - Imports: `Module` from `@nestjs/common`, `TypeOrmModule` from `@nestjs/typeorm`, `AuthModule` from `../users/auth.module`, the entity, the controller, the service.
  - `@Module({ imports: [AuthModule, TypeOrmModule.forFeature([NfbCalibrationRecord])], controllers: [NfbCalibrationGrpcController], providers: [NfbCalibrationService] })`.
  - Export class `NfbCalibrationModule {}`.
  - `AuthModule` is imported because the controller (in the next milestone) will use `@GrpcCurrentUser()` and `GrpcAuthInterceptor` provided by `AuthModule`'s public API — same as `BciModule`.

- [x] **Task 5: Register `NfbCalibrationModule` in `AppModule`** (depends on Task 4)
  Files: `src/app.module.ts`
  - Add `import { NfbCalibrationModule } from './nfb-calibration/nfb-calibration.module';` next to the existing module imports.
  - Add `NfbCalibrationModule` to the `imports` array of the `@Module` decorator. Place it adjacent to `BciModule` to keep BCI-related modules grouped.

## Verification

After all tasks:
- `npm run build` succeeds (TypeScript compiles, decorators resolve).
- App boot does not throw — TypeORM finds the `nfb_calibration_records` table created by the prior migration and matches it to the entity columns.
- No new endpoints exposed yet — controller has no `@GrpcMethod` handlers; that is intentional and is owned by the next milestone.

<!-- orchestrator-sessions
planner: 26cf37eb-f840-4255-bc5b-17ea248994b9
elapsed: 494
implementer: 1ff0f875-25f3-44a1-b4eb-6c71648c6846
-->
