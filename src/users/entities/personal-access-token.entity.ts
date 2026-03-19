import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('personal_access_tokens')
export class PersonalAccessToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column({ unique: true })
  tokenHash: string;

  @Column('character varying')
  name: string;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastUsedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
