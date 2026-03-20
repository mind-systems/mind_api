import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChangeLogService, ChangesResult } from '../changelog/changelog.service';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly changeLogService: ChangeLogService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeOldEvents(): Promise<void> {
    await this.changeLogService.purge();
  }

  async getChanges(
    userId: string,
    afterId: number,
    limit: number,
  ): Promise<ChangesResult | { fullResync: true }> {
    const minEventId = await this.changeLogService.getMinEventId();

    if (minEventId !== null && afterId !== 0 && afterId < minEventId) {
      return { fullResync: true as const };
    }

    return this.changeLogService.getChanges(userId, afterId, limit);
  }
}
