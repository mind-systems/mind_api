import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('change_events')
@Index(['userId', 'id'])
export class ChangeEvent {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column('varchar')
  entity: string;

  @Column('uuid')
  refId: string;

  @Column('varchar')
  action: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
