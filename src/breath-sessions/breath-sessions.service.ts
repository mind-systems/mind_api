import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BreathSession } from './entities/breath-session.entity';
import { BreathSessionSettingsService } from './breath-session-settings.service';
import {
  CreateBreathSessionDto,
  UpdateBreathSessionDto,
  ReplaceBreathSessionDto,
} from './dto/breath-session.dto';
import { calculateComplexity } from './complexity/breath-session-complexity.calculator';
import { TimeOfDay } from './enums/time-of-day.enum';
import { StatsService } from 'src/stats/stats.service';
import { ChangeLogService } from 'src/changelog/changelog.service';
import {
  CHANGE_EVENT_LOGGED,
  ChangeEventPayload,
} from 'src/changelog/changelog.events';
import { ChangeAction, ChangeEntity } from 'src/changelog/changelog.enums';
import { SessionSection } from '../../proto/generated/breath_sessions';

interface CursorPayload {
  section: SessionSection;
  createdAt: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as CursorPayload;
    if (
      parsed.section !== SessionSection.STARRED &&
      parsed.section !== SessionSection.MINE &&
      parsed.section !== SessionSection.SHARED
    ) {
      throw new Error('invalid section');
    }
    const date = new Date(parsed.createdAt);
    if (isNaN(date.getTime())) {
      throw new Error('invalid createdAt');
    }
    if (!parsed.id || typeof parsed.id !== 'string') {
      throw new Error('invalid id');
    }
    return parsed;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

const SECTION_ORDER = [SessionSection.STARRED, SessionSection.MINE, SessionSection.SHARED];

const SUGGESTIONS_COMPLEXITY_THRESHOLD = 'SUGGESTIONS_COMPLEXITY_THRESHOLD';
const SUGGESTIONS_BEGINNER_BASELINE = 'SUGGESTIONS_BEGINNER_BASELINE';

@Injectable()
export class BreathSessionsService {
  private readonly logger = new Logger(BreathSessionsService.name);
  private readonly suggestionsComplexityThreshold: number;
  private readonly suggestionsBeginnerBaseline: number;

  constructor(
    @InjectRepository(BreathSession)
    private readonly breathSessionRepository: Repository<BreathSession>,
    private readonly settingsService: BreathSessionSettingsService,
    private readonly statsService: StatsService,
    private readonly configService: ConfigService,
    private readonly changeLogService: ChangeLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.suggestionsComplexityThreshold = Number(
      this.configService.get(SUGGESTIONS_COMPLEXITY_THRESHOLD, 50),
    );
    this.suggestionsBeginnerBaseline = Number(
      this.configService.get(SUGGESTIONS_BEGINNER_BASELINE, 40),
    );
  }

  private async querySection(
    section: SessionSection,
    userId: string | null,
    keyset: { createdAt: string; id: string } | null,
    take: number,
  ): Promise<BreathSession[]> {
    const qb = this.breathSessionRepository.createQueryBuilder('session');

    if (section === SessionSection.STARRED) {
      qb.innerJoin(
        'breath_session_settings',
        'settings',
        'settings."sessionId" = session.id AND settings."userId" = :userId AND settings.starred = true',
        { userId },
      );
    } else if (section === SessionSection.MINE) {
      qb.where('session."userId" = :userId', { userId });
    } else {
      // SHARED
      if (userId) {
        qb.where('session."userId" != :userId AND session.shared = true', { userId });
      } else {
        qb.where('session.shared = true');
      }
    }

    if (keyset) {
      qb.andWhere(
        '(date_trunc(\'milliseconds\', session."createdAt"), session.id) < (:cursorCreatedAt, :cursorId)',
        { cursorCreatedAt: keyset.createdAt, cursorId: keyset.id },
      );
    }

    // date_trunc('milliseconds') keeps ordering consistent with the ms-truncated cursor values
    // that JS Date.toISOString() produces when decoding a TypeORM-returned timestamp.
    qb.orderBy('date_trunc(\'milliseconds\', session."createdAt")', 'DESC')
      .addOrderBy('session.id', 'DESC')
      .take(take);

    return qb.getMany();
  }

  async create(
    userId: string,
    createDto: CreateBreathSessionDto,
  ): Promise<BreathSession> {
    const session = this.breathSessionRepository.create({
      ...createDto,
      userId,
      shared: createDto.shared ?? false,
      complexity: calculateComplexity(createDto.exercises),
    });

    const saved = await this.breathSessionRepository.save(session);

    const eventId = await this.changeLogService.log(
      ChangeEntity.BREATH_SESSION,
      saved.id,
      ChangeAction.CREATED,
      userId,
    );
    const payload: ChangeEventPayload = {
      id: eventId,
      entity: ChangeEntity.BREATH_SESSION,
      refId: saved.id,
      action: ChangeAction.CREATED,
      userId,
    };
    this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload);

    return saved;
  }

  async findList(
    userId: string | null,
    cursor: string | null,
    pageSize: number,
  ): Promise<{
    items: Array<BreathSession & { isStarred?: boolean; section: SessionSection }>;
    nextCursor: string | null;
  }> {
    if (pageSize < 1) {
      throw new BadRequestException('pageSize must be at least 1');
    }

    // Anonymous path: only SHARED section
    if (!userId) {
      let keyset: { createdAt: string; id: string } | null = null;
      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (decoded.section !== SessionSection.SHARED) {
          throw new BadRequestException('Invalid cursor');
        }
        keyset = { createdAt: decoded.createdAt, id: decoded.id };
      }

      const rows = await this.querySection(SessionSection.SHARED, null, keyset, pageSize);
      const items = rows.map((r) => ({ ...r, section: SessionSection.SHARED }));

      const nextCursor =
        items.length < pageSize
          ? null
          : encodeCursor({
              section: SessionSection.SHARED,
              createdAt: rows[rows.length - 1].createdAt.toISOString(),
              id: rows[rows.length - 1].id,
            });

      return { items, nextCursor };
    }

    // Authenticated path: boundary-spill loop over STARRED → MINE → SHARED
    let startSection = SessionSection.STARRED;
    let keyset: { createdAt: string; id: string } | null = null;

    if (cursor) {
      const decoded = decodeCursor(cursor);
      startSection = decoded.section;
      keyset = { createdAt: decoded.createdAt, id: decoded.id };
    }

    const collected: Array<BreathSession & { section: SessionSection }> = [];
    const startIdx = SECTION_ORDER.indexOf(startSection);

    for (let i = startIdx; i < SECTION_ORDER.length; i++) {
      const section = SECTION_ORDER[i];
      const remaining = pageSize - collected.length;
      if (remaining === 0) break;

      const rows = await this.querySection(section, userId, keyset, remaining);
      for (const row of rows) {
        collected.push({ ...row, section });
      }

      // Only the starting section uses the decoded keyset; subsequent sections start unbounded
      keyset = null;
    }

    // Attach isStarred
    const ids = collected.map((r) => r.id);
    const settingsMap =
      ids.length > 0
        ? await this.settingsService.findByUserAndSessions(userId, ids)
        : new Map();

    const items = collected.map((row) => ({
      ...row,
      isStarred:
        row.section === SessionSection.STARRED
          ? true
          : (settingsMap.get(row.id)?.starred ?? false),
    }));

    // Compute next cursor
    const nextCursor =
      collected.length < pageSize
        ? null
        : (() => {
            const last = collected[collected.length - 1];
            return encodeCursor({
              section: last.section,
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            });
          })();

    return { items, nextCursor };
  }

  async findBatch(
    ids: string[],
    userId: string | null,
  ): Promise<(BreathSession & { isStarred?: boolean })[]> {
    const sessions = await this.breathSessionRepository.find({
      where: { id: In(ids) },
    });

    if (!userId || sessions.length === 0) {
      return sessions;
    }

    const settingsMap = await this.settingsService.findByUserAndSessions(
      userId,
      sessions.map((s) => s.id),
    );

    return sessions.map((session) => ({
      ...session,
      isStarred: settingsMap.get(session.id)?.starred ?? false,
    }));
  }

  async findOne(
    id: string,
    userId?: string | null,
  ): Promise<BreathSession & { isStarred?: boolean }> {
    const session = await this.breathSessionRepository.findOne({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException('Breath session not found');
    }

    if (!userId) {
      return session;
    }

    const settingsMap = await this.settingsService.findByUserAndSessions(
      userId,
      [id],
    );
    const settings = settingsMap.get(id);
    return { ...session, isStarred: settings?.starred ?? false };
  }

  async update(
    id: string,
    userId: string,
    updateDto: UpdateBreathSessionDto,
  ): Promise<BreathSession> {
    const session = await this.breathSessionRepository.findOne({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException('Breath session not found');
    }

    // Только владелец может обновлять
    if (session.userId !== userId) {
      throw new ForbiddenException(
        'You can only update your own breath sessions',
      );
    }

    Object.assign(session, updateDto);
    if (updateDto.exercises) {
      session.complexity = calculateComplexity(updateDto.exercises);
    }
    const updated = await this.breathSessionRepository.save(session);

    const eventId = await this.changeLogService.log(
      ChangeEntity.BREATH_SESSION,
      updated.id,
      ChangeAction.UPDATED,
      userId,
    );
    const payload: ChangeEventPayload = {
      id: eventId,
      entity: ChangeEntity.BREATH_SESSION,
      refId: updated.id,
      action: ChangeAction.UPDATED,
      userId,
    };
    this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload);

    return updated;
  }

  async replace(
    id: string,
    userId: string,
    dto: ReplaceBreathSessionDto,
  ): Promise<BreathSession> {
    const session = await this.breathSessionRepository.findOne({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException('Breath session not found');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException(
        'You can only update your own breath sessions',
      );
    }

    session.description = dto.description;
    session.exercises = dto.exercises;
    session.shared = dto.shared;
    session.timeOfDay = dto.timeOfDay ?? null;
    session.complexity = calculateComplexity(dto.exercises);

    const replaced = await this.breathSessionRepository.save(session);

    const eventId = await this.changeLogService.log(
      ChangeEntity.BREATH_SESSION,
      replaced.id,
      ChangeAction.UPDATED,
      userId,
    );
    const payload: ChangeEventPayload = {
      id: eventId,
      entity: ChangeEntity.BREATH_SESSION,
      refId: replaced.id,
      action: ChangeAction.UPDATED,
      userId,
    };
    this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload);

    return replaced;
  }

  async findSuggestions(
    userId: string,
    timeOfDay: TimeOfDay,
  ): Promise<BreathSession[]> {
    const stats = await this.statsService.getStats(userId);

    const qb = this.breathSessionRepository
      .createQueryBuilder('session')
      .where(
        new Brackets((qb) => {
          qb.where('session.userId = :userId', { userId }).orWhere(
            'session.shared = :shared',
            { shared: true },
          );
        }),
      )
      .andWhere('session.timeOfDay = :timeOfDay', { timeOfDay });

    const baseline = Math.max(
      stats.maxCompletedComplexity,
      this.suggestionsBeginnerBaseline,
    );
    qb.andWhere('session.complexity <= :maxComplexity', {
      maxComplexity: baseline + this.suggestionsComplexityThreshold,
    });

    const results = await qb.orderBy('RANDOM()').limit(4).getMany();

    if (results.length === 0) {
      this.logger.debug(
        `No suggestions found for user=${userId}, timeOfDay=${timeOfDay}`,
      );
    }

    return results;
  }

  async remove(id: string, userId: string): Promise<void> {
    const session = await this.breathSessionRepository.findOne({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException('Breath session not found');
    }

    // Только владелец может удалять
    if (session.userId !== userId) {
      throw new ForbiddenException(
        'You can only delete your own breath sessions',
      );
    }

    await this.breathSessionRepository.softRemove(session);

    const eventId = await this.changeLogService.log(
      ChangeEntity.BREATH_SESSION,
      id,
      ChangeAction.DELETED,
      userId,
    );
    const payload: ChangeEventPayload = {
      id: eventId,
      entity: ChangeEntity.BREATH_SESSION,
      refId: id,
      action: ChangeAction.DELETED,
      userId,
    };
    this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload);
  }
}
