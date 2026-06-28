import {
  ConflictException,
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
  In,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { ModuleSession } from '../realtime/entities/module-session.entity';
import { BioSessionSample } from '../realtime/entities/bio-session-sample.entity';
import { SessionStreamSample } from '../realtime/entities/session-stream-sample.entity';
import { ActivityType } from '../realtime/enums/activity-type.enum';
import { AGG_REGISTRY, AggMode } from './biometric-aggregation.util';

const ROW_CAP = 60_000;
const FLAT_CAP = 50_000;

// Maximum number of raw per-point rows the LTTB points query may return.
// Unlike the grouped path (which returns one row per (sampleType, bucket, field)),
// the 'points' path returns one row per (sample element, numeric field) — on the order
// of 1–2 M rows for the 389 k-motion reference session. This is a conservative
// placeholder pending a real Task 6 measurement against that session; once the observed
// row count is known, lower this to measured-max + headroom to keep pathological
// synchronous reshapes bounded.
const LTTB_POINTS_ROW_CAP = 3_000_000;

// Padded upper bound for the coarse flushedAt filter. A batch flushed up to 2 minutes after
// `to` can still contain samples whose per-sample timestamp falls inside [from, to). Applying
// a padded LessThan prevents the ROW_CAP from firing on legitimate narrow windows in long
// sessions, while still bounding the SQL scan. The per-sample filter does the exact trim.
const FLUSHED_AT_PAD_MS = 120_000;

// Slack applied to the session's startedAt when filtering out garbage timestamps (e.g. epoch-0
// samples). Any sample whose timestamp is more than this many ms before the session start is
// dropped by the aggregation query.
const GARBAGE_TS_SLACK_MS = 60_000;

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
      .andWhere('ms.activityType != :root', { root: ActivityType.ROOT })
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
  ): Promise<ModuleSession> {
    const session = await this.moduleSessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return session;
  }

  async deleteRun(userId: string, sessionId: string): Promise<void> {
    const session = await this.assertSessionOwnership(userId, sessionId);
    if (session.endedAt == null) {
      throw new ConflictException(
        'Cannot delete a session that is still active',
      );
    }
    const rootId = session.rootSessionId;
    await this.moduleSessionRepo.delete({ id: sessionId });
    this.logger.log(`Deleted module session ${sessionId} for user ${userId}`);
    if (rootId == null) {
      return;
    }
    const remaining = await this.moduleSessionRepo.count({
      where: { rootSessionId: rootId },
    });
    if (remaining === 0) {
      await this.moduleSessionRepo.delete({ id: rootId });
      this.logger.log(`Deleted orphaned root session ${rootId}`);
    }
  }

  async listBiometrics(
    userId: string,
    sessionId: string,
    from?: string,
    to?: string,
    bucketSec?: number,
    agg?: string,
  ): Promise<Record<string, unknown>[]> {
    const session = await this.assertSessionOwnership(userId, sessionId);

    // Build the id set once: a child whose bio was stored under its root id will
    // match either its own id (legacy writes) or the root id (post-ingest-flip writes).
    // The set always contains 1 or 2 UUIDs and never contains a null.
    const bioSessionIds =
      session.rootSessionId != null
        ? [session.id, session.rootSessionId]
        : [session.id];

    if (bucketSec !== undefined) {
      const mode: AggMode = (agg ?? 'minmax') as AggMode;
      const strategy = AGG_REGISTRY[mode];
      const rows = await this.aggregateBiometrics(
        session,
        bioSessionIds,
        bucketSec,
        mode,
        from,
        to,
      );
      return strategy.reshape(rows, bucketSec);
    }

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    // Per-sample window: default to the activity's own time window when the caller
    // omits a bound. This trims root-bound bio rows to just this child's interval.
    // An in-flight session (endedAt null) keeps an open upper bound so live samples
    // are still returned.
    const fromMs = fromDate?.getTime() ?? session.startedAt.getTime();
    const toMs = toDate?.getTime() ?? session.endedAt?.getTime();

    const where: FindOptionsWhere<BioSessionSample> = {
      moduleSessionId: In(bioSessionIds),
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

  // Executes a parameterized SQL query that unnests each bio sample's data fields,
  // casts numeric leaf values, and returns either:
  //   - 'grouped' strategies (minmax, avg): per-bucket aggregates grouped by sampleType and
  //     field. The heavy unnest runs entirely in Postgres; only the small aggregated rowset
  //     returns to Node — so no ROW_CAP/413 guard is needed on the grouped path.
  //   - 'points' strategies (lttb): raw per-point rows (one per sample element per numeric
  //     field, no GROUP BY). The rowset can be large — LTTB_POINTS_ROW_CAP caps it with a
  //     LIMIT and a 413 guard after the query.
  // The strategy is determined by AGG_REGISTRY[agg].
  private async aggregateBiometrics(
    session: ModuleSession,
    bioSessionIds: string[],
    bucketSec: number,
    agg: AggMode,
    from?: string,
    to?: string,
  ): Promise<Record<string, unknown>[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    // Per-sample window: default to the activity's own time window when the caller
    // omits a bound, so root-bound bio rows are trimmed to just this child's interval.
    // An in-flight session (endedAt null) keeps an open upper bound (toMs undefined).
    const fromMs = fromDate?.getTime() ?? session.startedAt.getTime();
    const toMs = toDate?.getTime() ?? session.endedAt?.getTime();

    const strategy = AGG_REGISTRY[agg];

    const params: unknown[] = [];
    let n = 0;
    const p = (v: unknown): string => {
      params.push(v);
      return `$${++n}`;
    };

    const sessionIdsParam = p(bioSessionIds);
    const garbageBoundParam = p(
      session.startedAt.getTime() - GARBAGE_TS_SLACK_MS,
    );
    const bucketMsParam = p(bucketSec * 1000);

    // Shared WHERE conditions — identical for grouped and points paths.
    // This guarantees that 'lttb' filters the same samples as 'avg'/'minmax'.
    const conditions: string[] = [
      `b."moduleSessionId" = ANY(${sessionIdsParam})`,
      `jsonb_typeof(elem->'timestamp') = 'number'`,
      `jsonb_typeof(elem->'data') = 'object'`,
      `jsonb_typeof(kv.value) = 'number'`,
      `(elem->>'timestamp')::numeric > ${garbageBoundParam}`,
    ];

    // Coarse flushedAt filter (mirrors raw path branching)
    if (fromDate && toDate) {
      conditions.push(`b."flushedAt" >= ${p(fromDate)}`);
      conditions.push(
        `b."flushedAt" < ${p(new Date(toDate.getTime() + FLUSHED_AT_PAD_MS))}`,
      );
    } else if (fromDate) {
      conditions.push(`b."flushedAt" >= ${p(fromDate)}`);
    } else if (toDate) {
      conditions.push(
        `b."flushedAt" < ${p(new Date(toDate.getTime() + FLUSHED_AT_PAD_MS))}`,
      );
    }

    // Per-sample exact window filter
    if (fromMs !== undefined) {
      conditions.push(`(elem->>'timestamp')::numeric >= ${p(fromMs)}`);
    }
    if (toMs !== undefined) {
      conditions.push(`(elem->>'timestamp')::numeric < ${p(toMs)}`);
    }

    // The SQL bucket expression `floor(ts / bucketMs)` must stay in lockstep with
    // bucketIndexForMs() in biometric-aggregation.util.ts. Both use epoch 0 as origin.
    // Because the unit test is DB-less, this equivalence is guarded by this comment/contract,
    // not by automated verification (see e2e integration test for SQL↔helper equivalence).
    const whereClause = conditions.join('\n        AND ');
    const selectHeader = `
      SELECT
        elem->>'sampleType' AS "sampleType",
        floor((elem->>'timestamp')::numeric / ${bucketMsParam}) AS bucket,
        kv.key AS field,
        ${strategy.selectColumns}
      FROM bio_session_samples b,
        jsonb_array_elements(b.samples) AS elem,
        jsonb_each(elem->'data') AS kv
      WHERE ${whereClause}`;

    let sql: string;
    if (strategy.kind === 'points') {
      // No GROUP BY, no ORDER BY — reshapeLttbRows re-sorts each group in JS,
      // so an SQL sort over the full (large) raw rowset is wasted work.
      // LIMIT enforces the resource guard; the post-query check below throws 413.
      sql = `${selectHeader}
      LIMIT ${LTTB_POINTS_ROW_CAP + 1}
    `;
    } else {
      // ORDER BY is redundant once reshape applies a total (timestamp, sampleType) sort,
      // but it clarifies intent and makes EXPLAIN output easier to read in production.
      sql = `${selectHeader}
      GROUP BY "sampleType", bucket, field
      ORDER BY "sampleType", bucket, field
    `;
    }

    const rows: Record<string, unknown>[] = await this.bioSampleRepo.query(
      sql,
      params,
    );

    if (strategy.kind === 'points' && rows.length > LTTB_POINTS_ROW_CAP) {
      throw new PayloadTooLargeException(
        'Result set too large; narrow the time window',
      );
    }

    return rows;
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
