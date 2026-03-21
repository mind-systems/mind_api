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
import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @Column('uuid', { name: 'userId' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ example: 'Morning relaxation' })
  @Column('text')
  description: string;

  @ApiProperty({
    example: [
      {
        steps: [{ type: 'inhale', duration: 4 }],
        restDuration: 2,
        repeatCount: 3,
      },
    ],
  })
  @Column('jsonb')
  exercises: BreathExercise[];

  @ApiProperty({ example: 1260 })
  @Column({ name: 'complexity', type: 'float', nullable: false, default: 0 })
  complexity: number;

  @ApiProperty({ example: false })
  @Column('boolean', { default: false })
  @Index()
  shared: boolean;

  @ApiProperty({ enum: TimeOfDay, example: TimeOfDay.MORNING, nullable: true })
  @Column({ type: 'enum', enum: TimeOfDay, nullable: true, default: null })
  timeOfDay: TimeOfDay | null;

  @ApiProperty({ example: '2026-02-27T12:48:00.000Z' })
  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @ApiProperty({ example: '2026-02-27T12:48:00.000Z' })
  @UpdateDateColumn()
  updatedAt: Date;

  @ApiProperty({ example: null, nullable: true })
  @DeleteDateColumn()
  deletedAt: Date | null;
}
