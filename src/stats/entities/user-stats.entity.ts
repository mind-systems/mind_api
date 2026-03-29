import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_stats')
export class UserStats {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No FK to users — intentional loose coupling, same pattern as ModuleSession
  @Index({ unique: true })
  @Column()
  userId: string;

  @Column({ type: 'int', default: 0 })
  totalSessions: number;

  @Column({ type: 'int', default: 0 })
  totalDurationSeconds: number;

  @Column({ type: 'int', default: 0 })
  currentStreak: number;

  @Column({ type: 'int', default: 0 })
  longestStreak: number;

  @Column({ type: 'float', default: 0 })
  maxCompletedComplexity: number;

  @Column({ type: 'date', nullable: true })
  lastSessionDate: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
