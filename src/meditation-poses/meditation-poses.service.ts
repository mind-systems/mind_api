import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeditationPose } from './entities/meditation-pose.entity';

@Injectable()
export class MeditationPosesService {
  constructor(
    @InjectRepository(MeditationPose)
    private readonly repo: Repository<MeditationPose>,
  ) {}

  listAll(): Promise<MeditationPose[]> {
    return this.repo.find({ order: { displayOrder: 'ASC' } });
  }
}
