import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('meditation_poses')
export class MeditationPose {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string;

  @Column({ name: 'display_order', type: 'smallint' })
  displayOrder: number;
}
