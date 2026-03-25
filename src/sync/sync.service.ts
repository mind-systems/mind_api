import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChangeLogService } from 'src/changelog/changelog.service';

export interface SyncChangesResult {
  events: {
    id: number;
    entity: string;
    refId: string;
    action: string;
    createdAt: Date;
  }[];
  cursor: number;
  hasMore: boolean;
}

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
  ): Promise<SyncChangesResult | { fullResync: true }> {
    const minEventId = await this.changeLogService.getMinEventId();

    if (minEventId !== null && afterId !== 0 && afterId < minEventId) {
      return { fullResync: true as const };
    }

    const result = await this.changeLogService.getChanges(
      userId,
      afterId,
      limit,
    );
    return {
      ...result,
      events: result.events.map(({ id, entity, refId, action, createdAt }) => ({
        id,
        entity,
        refId,
        action,
        createdAt,
      })),
    };
  }
}
