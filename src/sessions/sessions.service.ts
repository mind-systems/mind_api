import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  FindOptionsWhere,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { ModuleSession } from '../realtime/entities/module-session.entity';
import { BioSessionSample } from '../realtime/entities/bio-session-sample.entity';
import { SessionStreamSample } from '../realtime/entities/session-stream-sample.entity';
import { ActivityType } from '../realtime/enums/activity-type.enum';

const ROW_CAP = 60_000;
const FLAT_CAP = 50_000;

// Padded upper bound for the coarse flushedAt filter. A batch flushed up to 2 minutes after
// `to` can still contain samples whose per-sample timestamp falls inside [from, to). Applying
// a padded LessThan prevents the ROW_CAP from firing on legitimate narrow windows in long
// sessions, while still bounding the SQL scan. The per-sample filter does the exact trim.
const FLUSHED_AT_PAD_MS = 120_000;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(ModuleSession)
    private readonly moduleSessionRepo: Repository<ModuleSession>,
    @InjectRepository(BioSessionSample)
    private readonly bioSampleRepo: Repository<BioSessionSample>,
    @InjectRepository(SessionStreamSample)
    private readonly streamSampleRepo: Repository<SessionStreamSample>,
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
      activityType: ActivityType;
      description: string | null;
      complexity: number | null;
    }[];
    total: number;
  }> {
    const take = Math.min(limit ?? 50, 200);
    const skip = offset ?? 0;

    const baseQuery = this.moduleSessionRepo
      .createQueryBuilder('ms')
      .leftJoin(
        'breath_sessions',
        'bs',
        'bs.id = ms."activityRefId" AND ms."activityType" = :breath AND bs."deletedAt" IS NULL',
        { breath: ActivityType.BREATH },
      )
      .addSelect('bs.description', 'bs_description')
      .addSelect('bs.complexity', 'bs_complexity')
      .where('ms.userId = :userId', { userId })
      .andWhere('ms.endedAt IS NOT NULL')
      .orderBy('ms.startedAt', 'DESC');

    const total = await baseQuery.getCount();

    const { entities, raw } = await baseQuery
      .take(take)
      .skip(skip)
      .getRawAndEntities();

    const items = entities.map((entity, i) => {
      const r = raw[i];
      const durationSeconds = Math.round(
        (entity.endedAt!.getTime() - entity.startedAt.getTime()) / 1000,
      );
      return {
        id: entity.id,
        startedAt: entity.startedAt,
        endedAt: entity.endedAt as Date,
        durationSeconds,
        activityType: entity.activityType,
        description: (r.bs_description as string | null) ?? null,
        complexity: r.bs_complexity != null ? Number(r.bs_complexity) : null,
      };
    });

    return { items, total };
  }

  // NOTE: does NOT require endedAt IS NOT NULL — in-flight sessions are intentionally queryable.
  // The dashboard's live-session view needs to read data while a session is still active.
  // UUIDs are not guessable; the userId ownership check is the security boundary.
  private async assertSessionOwnership(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.moduleSessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
  }

  async deleteRun(userId: string, sessionId: string): Promise<void> {
    await this.assertSessionOwnership(userId, sessionId);
    await this.moduleSessionRepo.delete({ id: sessionId });
    this.logger.log(`Deleted module session ${sessionId} for user ${userId}`);
  }

  async listBiometrics(
    userId: string,
    sessionId: string,
    from?: string,
    to?: string,
  ): Promise<Record<string, unknown>[]> {
    await this.assertSessionOwnership(userId, sessionId);

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const fromMs = fromDate?.getTime();
    const toMs = toDate?.getTime();

    const where: FindOptionsWhere<BioSessionSample> = {
      moduleSessionId: sessionId,
    };
    // Coarse flushedAt filter: lower bound drops batches that definitely predate the window.
    // Upper bound is padded by FLUSHED_AT_PAD_MS so batches flushed slightly after `to` are
    // still fetched — the per-sample timestamp filter below does the exact [from, to) trim.
    if (fromDate && toDate) {
      where.flushedAt = And(
        MoreThanOrEqual(fromDate),
        LessThan(new Date(toDate.getTime() + FLUSHED_AT_PAD_MS)),
      );
    } else if (fromDate) {
      where.flushedAt = MoreThanOrEqual(fromDate);
    } else if (toDate) {
      where.flushedAt = LessThan(
        new Date(toDate.getTime() + FLUSHED_AT_PAD_MS),
      );
    }

    const rows = await this.bioSampleRepo.find({
      where,
      order: { flushedAt: 'ASC' },
      take: ROW_CAP,
    });

    if (rows.length === ROW_CAP) {
      throw new PayloadTooLargeException(
        'Result set too large; narrow the time window',
      );
    }

    // Verified write-path shape: { timestamp: number, sampleType, data }.
    const flat: Record<string, unknown>[] = [];
    for (const row of rows) {
      for (const sample of row.samples ?? []) {
        const ts =
          typeof sample['timestamp'] === 'number'
            ? sample['timestamp']
            : undefined;
        if (ts === undefined) {
          // Defensive: skip malformed samples rather than crashing the whole request.
          continue;
        }
        if (fromMs !== undefined && ts < fromMs) continue;
        if (toMs !== undefined && ts >= toMs) continue;
        flat.push(sample);
        if (flat.length > FLAT_CAP) {
          throw new PayloadTooLargeException(
            'Result set too large; narrow the time window',
          );
        }
      }
    }

    flat.sort(
      (a, b) => (a['timestamp'] as number) - (b['timestamp'] as number),
    );

    return flat;
  }

  async listInstructions(
    userId: string,
    sessionId: string,
    from?: string,
    to?: string,
  ): Promise<Record<string, unknown>[]> {
    await this.assertSessionOwnership(userId, sessionId);

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const fromMs = fromDate?.getTime();
    const toMs = toDate?.getTime();

    const where: FindOptionsWhere<SessionStreamSample> = {
      moduleSessionId: sessionId,
    };
    // Same coarse flushedAt filter strategy as listBiometrics — padded upper bound prevents
    // false-413 on narrow windows in long sessions.
    if (fromDate && toDate) {
      where.flushedAt = And(
        MoreThanOrEqual(fromDate),
        LessThan(new Date(toDate.getTime() + FLUSHED_AT_PAD_MS)),
      );
    } else if (fromDate) {
      where.flushedAt = MoreThanOrEqual(fromDate);
    } else if (toDate) {
      where.flushedAt = LessThan(
        new Date(toDate.getTime() + FLUSHED_AT_PAD_MS),
      );
    }

    const rows = await this.streamSampleRepo.find({
      where,
      order: { flushedAt: 'ASC' },
      take: ROW_CAP,
    });

    if (rows.length === ROW_CAP) {
      throw new PayloadTooLargeException(
        'Result set too large; narrow the time window',
      );
    }

    // Verified write-path shape (module-instruction-stream.grpc.controller.ts:110-115):
    // { timestamp: number, moduleId: string, instructionType: string, data: unknown }.
    // Pass jsonb elements through verbatim — do not rename or filter fields.
    const flat: Record<string, unknown>[] = [];
    for (const row of rows) {
      for (const sample of row.samples ?? []) {
        const ts =
          typeof sample['timestamp'] === 'number'
            ? sample['timestamp']
            : undefined;
        if (ts === undefined) {
          // Defensive: skip malformed samples rather than crashing the whole request.
          continue;
        }
        if (fromMs !== undefined && ts < fromMs) continue;
        if (toMs !== undefined && ts >= toMs) continue;
        flat.push(sample);
        if (flat.length > FLAT_CAP) {
          throw new PayloadTooLargeException(
            'Result set too large; narrow the time window',
          );
        }
      }
    }

    flat.sort((a, b) => Number(a['timestamp']) - Number(b['timestamp']));

    return flat;
  }
}
