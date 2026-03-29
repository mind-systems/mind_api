import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('session_stream_samples')
@Index(['moduleSessionId'])
export class SessionStreamSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  moduleSessionId: string;

  @Column({ type: 'jsonb' })
  samples: Record<string, unknown>[];

  @Column()
  flushedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
