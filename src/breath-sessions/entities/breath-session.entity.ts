import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { TimeOfDay } from '../enums/time-of-day.enum';

export interface BreathStep {
  type: 'inhale' | 'exhale' | 'hold';
  duration: number;
}

export interface BreathExercise {
  steps: BreathStep[];
  restDuration: number;
  repeatCount: number;
}

@Entity('breath_sessions')
@Index(['userId', 'createdAt'])
@Index(['shared', 'createdAt'])
export class BreathSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'userId' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column('text')
  description: string;

  @Column('jsonb')
  exercises: BreathExercise[];

  @Column({ name: 'complexity', type: 'float', nullable: false, default: 0 })
  complexity: number;

  @Column('boolean', { default: false })
  @Index()
  shared: boolean;

  @Column({ type: 'enum', enum: TimeOfDay, nullable: true, default: null })
  timeOfDay: TimeOfDay | null;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
