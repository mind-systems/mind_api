import { Module } from '@nestjs/common';
import { AuthModule } from 'src/users/auth.module';
import { SyncController } from './sync.controller';
import { SyncGrpcController } from './sync.grpc.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AuthModule],
  controllers: [SyncController, SyncGrpcController],
  providers: [SyncService],
})
export class SyncModule {}
