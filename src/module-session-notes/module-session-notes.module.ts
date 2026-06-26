import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { ModuleSessionNote } from './entities/module-session-note.entity';
import { ModuleSessionNotesGrpcController } from './module-session-notes.grpc.controller';
import { ModuleSessionNotesService } from './module-session-notes.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([ModuleSessionNote])],
  controllers: [ModuleSessionNotesGrpcController],
  providers: [ModuleSessionNotesService],
})
export class ModuleSessionNotesModule {}
