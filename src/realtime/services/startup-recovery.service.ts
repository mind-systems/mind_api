import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleSession } from '../entities/module-session.entity';
import { SessionStreamSample } from '../entities/session-stream-sample.entity';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityType } from '../enums/activity-type.enum';
import { ActivitySessionStore } from './activity-session-store.service';
import { ActivityEngine } from './activity-engine.service';
import { ActivityState } from '../interfaces/activity-state.interface';
import { StreamSessionEvent } from '../constants/stream-data-types';

interface PauseMarkerSample {
  timestamp: number;
  data: { dataType: string; event: string };
}

@Injectable()
export class StartupRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupRecoveryService.name);

  constructor(
    @InjectRepository(ModuleSession)
    private readonly repo: Repository<ModuleSession>,
    @InjectRepository(SessionStreamSample)
    private readonly streamSampleRepo: Repository<SessionStreamSample>,
    private readonly activitySessionStore: ActivitySessionStore,
    private readonly activityEngine: ActivityEngine,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const orphans = await this.repo.find({
      where: [
        { status: SessionStatus.ACTIVE },
        { status: SessionStatus.DISCONNECTED },
      ],
    });
    if (orphans.length === 0) return;

    const roots = orphans.filter(
      (s) => s.activityType === ActivityType.ROOT && s.rootSessionId === null,
    );
    const children = orphans.filter(
      (s) =>
        !(s.activityType === ActivityType.ROOT && s.rootSessionId === null),
    );

    for (const root of roots) {
      const state: ActivityState = {
        sessionId: root.id,
        activityType: root.activityType,
        activityRefId: root.activityRefId,
        rootSessionId: root.rootSessionId,
        startedAt: root.startedAt,
        lastActivityAt: root.lastActivityAt,
        isPaused: false,
      };
      this.activitySessionStore.setRoot(root.userId, root.id, state);
    }

    for (const child of children) {
      const isPaused = await this.deriveIsPaused(child.id);
      const state: ActivityState = {
        sessionId: child.id,
        activityType: child.activityType,
        activityRefId: child.activityRefId,
        rootSessionId: child.rootSessionId,
        startedAt: child.startedAt,
        lastActivityAt: child.lastActivityAt,
        isPaused,
      };
      this.activitySessionStore.addChild(child.userId, child.id, state);
    }

    await this.repo.save(
      orphans.map((s) => ({
        ...s,
        status: SessionStatus.DISCONNECTED,
        disconnectedAt: s.lastActivityAt,
      })),
    );

    for (const session of orphans) {
      this.activitySessionStore.startGraceTimerForSession(session.id, () => {
        this.activityEngine
          .abandonActivity(session.userId, session.id)
          .catch((err: unknown) => {
            this.logger.error(
              `Failed to abandon rehydrated session after grace: sessionId=${session.id}`,
              err,
            );
          });
      });
    }

    this.logger.log(
      `Startup recovery: rehydrated ${orphans.length} session(s) (${roots.length} root, ${children.length} child)`,
    );
  }

  /** Derives isPaused for a child session from its durable pause markers:
   *  the latest PAUSED/RESUMED marker in session_stream_samples decides.
   *  No marker at all → not paused. */
  private async deriveIsPaused(sessionId: string): Promise<boolean> {
    const rows = await this.streamSampleRepo.find({
      where: { moduleSessionId: sessionId },
    });

    let latestMarker: PauseMarkerSample | undefined;
    for (const row of rows) {
      const samples = row.samples as unknown as PauseMarkerSample[];
      for (const sample of samples) {
        const event = sample?.data?.event;
        if (
          event !== StreamSessionEvent.PAUSED &&
          event !== StreamSessionEvent.RESUMED
        ) {
          continue;
        }
        if (!latestMarker || sample.timestamp > latestMarker.timestamp) {
          latestMarker = sample;
        }
      }
    }

    return latestMarker?.data.event === StreamSessionEvent.PAUSED;
  }
}
