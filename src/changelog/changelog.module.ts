import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChangeEvent } from './entities/change-event.entity';
import { ChangeLogService } from './changelog.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ChangeEvent])],
  providers: [ChangeLogService],
  exports: [ChangeLogService],
})
export class ChangelogModule {}
