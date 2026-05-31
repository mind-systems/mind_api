import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('auth_codes')
export class AuthCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_auth_codes_email')
  @Column()
  email: string;

  @Index('IDX_auth_codes_code_hash')
  @Column()
  codeHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @Index('IDX_auth_codes_expires_at')
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ default: false })
  used: boolean;

  @Column({ type: 'smallint', default: 0 })
  failedAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lockedUntil: Date | null;
}
