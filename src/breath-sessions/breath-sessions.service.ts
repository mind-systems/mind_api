import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class BreathSessionsService {
  private readonly suggestionsComplexityThreshold: number;

  constructor(
    @InjectRepository(BreathSession)
    private readonly breathSessionRepository: Repository<BreathSession>,
    private readonly settingsService: BreathSessionSettingsService,
    private readonly statsService: StatsService,
    private readonly configService: ConfigService,
  ) {
    this.suggestionsComplexityThreshold = Number(
      this.configService.get('SUGGESTIONS_COMPLEXITY_THRESHOLD', 50),
    );
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

    return this.breathSessionRepository.save(session);
  }

  async findList(userId: string | null, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    if (!userId) {
      const [data, total] = await this.breathSessionRepository.findAndCount({
        where: { shared: true },
        order: { createdAt: 'DESC' },
        skip,
        take: pageSize,
      });
      return { data, total, page, pageSize };
    }

    // Single query with 3-group priority:
    // 1) isMine=true (own sessions, any starred/shared status)
    // 2) isMine=false, starred=true (others' starred)
    // 3) isMine=false, starred=false, shared=true (others' shared)
    const qb = this.breathSessionRepository
      .createQueryBuilder('session')
      .leftJoin(
        'breath_session_settings',
        'settings',
        'settings."sessionId" = session.id AND settings."userId" = :userId',
        { userId },
      )
      .where(
        '(session."userId" = :userId OR (settings.starred = true AND session."userId" != :userId) OR (session.shared = true AND session."userId" != :userId))',
        { userId },
      )
      .addSelect(
        `CASE
          WHEN session."userId" = :userId THEN 0
          WHEN settings.starred = true THEN 1
          ELSE 2
        END`,
        'group_priority',
      )
      .orderBy('group_priority', 'ASC')
      .addOrderBy('session.createdAt', 'DESC')
      .skip(skip)
      .take(pageSize);

    const [sessions, total] = await qb.getManyAndCount();

    const settingsMap = await this.settingsService.findByUserAndSessions(
      userId,
      sessions.map((s) => s.id),
    );

    const data = sessions.map((session) => ({
      ...session,
      isStarred: settingsMap.get(session.id)?.starred ?? false,
    }));

    return { data, total, page, pageSize };
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
    return this.breathSessionRepository.save(session);
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

    return this.breathSessionRepository.save(session);
  }

  async findSuggestions(
    userId: string,
    timeOfDay: TimeOfDay,
  ): Promise<BreathSession[]> {
    const stats = await this.statsService.getStats(userId);

    const qb = this.breathSessionRepository
      .createQueryBuilder('session')
      .where('session.userId = :userId', { userId })
      .andWhere('session.timeOfDay = :timeOfDay', { timeOfDay });

    if (stats.maxCompletedComplexity > 0) {
      qb.andWhere('session.complexity <= :maxComplexity', {
        maxComplexity:
          stats.maxCompletedComplexity + this.suggestionsComplexityThreshold,
      });
    }

    return qb.orderBy('RANDOM()').limit(4).getMany();
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

    await this.breathSessionRepository.remove(session);
  }
}
