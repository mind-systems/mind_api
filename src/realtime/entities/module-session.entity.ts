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
export class ModuleSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No @ManyToOne FK to User — intentional loose coupling between realtime and users modules.
  // Integrity is enforced at the service layer (userId comes from validated JWT).
  @Column()
  userId: string;

  @Column({ type: 'enum', enum: ActivityType })
  activityType: ActivityType;

  @Column({ nullable: true })
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
