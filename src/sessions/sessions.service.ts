import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ModuleSession } from '../realtime/entities/module-session.entity';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(ModuleSession)
    private readonly repo: Repository<ModuleSession>,
  ) {}

  async listRuns(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<{
    items: {
      id: string;
      startedAt: Date;
      endedAt: Date;
      durationSeconds: number;
    }[];
    total: number;
  }> {
    const take = Math.min(limit ?? 50, 200);
    const skip = offset ?? 0;

    const [rows, total] = await this.repo.findAndCount({
      where: { userId, endedAt: Not(IsNull()) },
      order: { startedAt: 'DESC' },
      take,
      skip,
    });

    const items = rows.flatMap((row) => {
      if (!row.endedAt) {
        return [];
      }
      const durationSeconds = Math.round(
        (row.endedAt.getTime() - row.startedAt.getTime()) / 1000,
      );
      return [{ id: row.id, startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds }];
    });

    return { items, total };
  }
}
