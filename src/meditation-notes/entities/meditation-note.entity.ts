import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('meditation_notes')
export class MeditationNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column('uuid', { name: 'session_id', nullable: true })
  sessionId: string | null;

  @Column({ name: 'pose_name' })
  poseName: string;

  @Column({ name: 'note_text', type: 'text' })
  noteText: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
