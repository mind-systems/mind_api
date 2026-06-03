import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeditationNote } from './entities/meditation-note.entity';

@Injectable()
export class MeditationNotesService {
  constructor(
    @InjectRepository(MeditationNote)
    private readonly repo: Repository<MeditationNote>,
  ) {}
}
