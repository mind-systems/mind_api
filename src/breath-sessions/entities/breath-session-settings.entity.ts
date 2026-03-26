import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { BreathSession } from './breath-session.entity';

@Entity('breath_session_settings')
@Unique(['userId', 'sessionId'])
@Index(['userId', 'starred'])
export class BreathSessionSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'userId' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column('uuid', { name: 'sessionId' })
  sessionId: string;

  @ManyToOne(() => BreathSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: BreathSession;

  @Column('boolean', { default: false })
  starred: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
