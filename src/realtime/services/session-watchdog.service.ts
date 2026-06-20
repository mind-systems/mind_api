import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ModuleSession } from '../entities/module-session.entity';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityEngine } from './activity-engine.service';
import { RealtimeConfig } from '../constants/realtime-config';

@Injectable()
export class SessionWatchdogService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SessionWatchdogService.name);
  private readonly maxIdleMs: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @InjectRepository(ModuleSession)
    private readonly repo: Repository<ModuleSession>,
    private readonly activityEngine: ActivityEngine,
    private readonly configService: ConfigService,
  ) {
    this.maxIdleMs = this.configService.get<number>(
      RealtimeConfig.SESSION_MAX_IDLE_MS,
      600_000,
    );
    this.sweepIntervalMs = this.configService.get<number>(
      RealtimeConfig.SESSION_SWEEP_INTERVAL_MS,
      60_000,
    );
  }

  onApplicationBootstrap(): void {
    this.sweepTimer = setInterval(() => {
      this.sweep().catch((err: unknown) => {
        this.logger.error('Periodic watchdog sweep failed', err);
      });
    }, this.sweepIntervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
    }
  }

  async sweep(): Promise<void> {
    const threshold = new Date(Date.now() - this.maxIdleMs);
    const staleSessions = await this.repo.find({
      where: {
        status: In([SessionStatus.ACTIVE, SessionStatus.DISCONNECTED]),
        lastActivityAt: LessThan(threshold),
      },
    });

    if (staleSessions.length === 0) {
      return;
    }

    let reaped = 0;
    for (const row of staleSessions) {
      const idleMs = Date.now() - row.lastActivityAt.getTime();
      try {
        this.logger.warn(
          `Watchdog reaping stale session: sessionId=${row.id} userId=${row.userId} idleMs=${idleMs}`,
        );
        await this.activityEngine.abandonStale(row.userId, row.id);
        reaped++;
      } catch (err: unknown) {
        this.logger.error(`Watchdog failed to reap sessionId=${row.id}`, err);
      }
    }

    this.logger.warn(`Watchdog swept ${reaped} stale sessions`);
  }
}
