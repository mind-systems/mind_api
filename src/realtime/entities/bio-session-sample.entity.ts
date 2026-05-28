import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('bio_session_samples')
@Index(['moduleSessionId'])
export class BioSessionSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  moduleSessionId: string;

  @Column({ type: 'jsonb' })
  samples: Record<string, unknown>[];

  @Column()
  flushedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
