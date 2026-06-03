import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { MeditationNote } from './entities/meditation-note.entity';
import { MeditationNotesGrpcController } from './meditation-notes.grpc.controller';
import { MeditationNotesService } from './meditation-notes.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([MeditationNote])],
  controllers: [MeditationNotesGrpcController],
  providers: [MeditationNotesService],
})
export class MeditationNotesModule {}
