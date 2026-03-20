import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChangeEvent } from './entities/change-event.entity';

export interface ChangesResult {
  events: ChangeEvent[];
  cursor: number;
  hasMore: boolean;
}

@Injectable()
export class ChangeLogService {
  private readonly logger = new Logger(ChangeLogService.name);

  constructor(
    @InjectRepository(ChangeEvent)
    private readonly changeEventRepo: Repository<ChangeEvent>,
  ) {}

  async log(
    entity: string,
    refId: string,
    action: string,
    userId: string,
  ): Promise<number> {
    const result = await this.changeEventRepo.insert({ entity, refId, action, userId });
    return result.identifiers[0].id as number;
  }

  async logForRecipients(
    entity: string,
    refId: string,
    action: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;

    const values = userIds
      .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
      .join(', ');

    const params: string[] = [];
    for (const uid of userIds) {
      params.push(entity, refId, action, uid);
    }

    await this.changeEventRepo.query(
      `INSERT INTO "change_events" ("entity", "refId", "action", "userId") VALUES ${values}`,
      params,
    );
  }

  async getChanges(
    userId: string,
    afterId: number,
    limit = 100,
  ): Promise<ChangesResult> {
    const rows = await this.changeEventRepo
      .createQueryBuilder('ce')
      .where('ce.userId = :userId', { userId })
      .andWhere('ce.id > :afterId', { afterId })
      .orderBy('ce.id', 'ASC')
      .limit(limit + 1)
      .getMany();

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    const cursor = events.length > 0 ? events[events.length - 1].id : afterId;

    return { events, cursor, hasMore };
  }

  async getMinEventId(): Promise<number | null> {
    const result = await this.changeEventRepo
      .createQueryBuilder('ce')
      .select('MIN(ce.id)', 'min')
      .getRawOne<{ min: string | null }>();

    return result?.min != null ? parseInt(result.min, 10) : null;
  }

  async purge(olderThanDays = 30): Promise<void> {
    const result = await this.changeEventRepo
      .createQueryBuilder()
      .delete()
      .where('"createdAt" < now() - make_interval(days => :days)', { days: olderThanDays })
      .execute();

    this.logger.log(`purge: removed ${result.affected ?? 0} change events older than ${olderThanDays} days`);
  }
}
