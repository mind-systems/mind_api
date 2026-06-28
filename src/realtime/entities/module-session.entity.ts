import {
  CreateDateColumn,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityType } from '../enums/activity-type.enum';
import { SessionStatus } from '../enums/session-status.enum';

@Entity('module_sessions')
@Index(['userId'])
@Index(['status'])
@Index(['rootSessionId'])
export class ModuleSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No @ManyToOne — modules stay decoupled at the ORM level.
  // FK constraint enforced in the InitialSchema migration.
  @Column({ type: 'uuid' })
  userId: string;

  // No @ManyToOne — modules stay decoupled at the ORM level (mirrors userId).
  // Self-referential FK constraint enforced in the migration, not via @ManyToOne.
  @Column({ type: 'uuid', nullable: true })
  rootSessionId: string | null;

  @Column({ type: 'enum', enum: ActivityType })
  activityType: ActivityType;

  @Column({ type: 'uuid', nullable: true })
  activityRefId?: string;

  @Column({ type: 'enum', enum: SessionStatus, default: SessionStatus.ACTIVE })
  status: SessionStatus;

  @Column()
  startedAt: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  disconnectedAt: Date | null;

  @Column({ nullable: true })
  endedAt?: Date;

  @Column()
  lastActivityAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
