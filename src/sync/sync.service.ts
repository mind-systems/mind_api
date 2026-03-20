import { Injectable } from '@nestjs/common';
import { ChangeLogService, ChangesResult } from '../changelog/changelog.service';

@Injectable()
export class SyncService {
  constructor(private readonly changeLogService: ChangeLogService) {}

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
