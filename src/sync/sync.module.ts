import { Module } from '@nestjs/common';
import { AuthModule } from 'src/users/auth.module';
import { SyncGrpcController } from './sync.grpc.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AuthModule],
  controllers: [SyncGrpcController],
  providers: [SyncService],
})
export class SyncModule {}
