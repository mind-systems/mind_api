import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModuleSession } from '../entities/module-session.entity';
import { ActivitySessionStore } from './activity-session-store.service';
import { ActivityState } from '../interfaces/activity-state.interface';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityType } from '../enums/activity-type.enum';
import { StreamEngine } from './stream-engine.service';
import {
  MODULE_SESSION_PAUSED,
  MODULE_SESSION_UNPAUSED,
} from '../events/module-session.events';
import { SessionEvents } from '../events/session.events';
import {
  StreamDataType,
  StreamSessionEvent,
} from '../constants/stream-data-types';
import { WsErrorCode } from '../constants/ws-error-codes';

@Injectable()
export class ActivityEngine {
  private readonly logger = new Logger(ActivityEngine.name);

  constructor(
    @InjectRepository(ModuleSession)
    private readonly repo: Repository<ModuleSession>,
    private readonly activitySessionStore: ActivitySessionStore,
    private readonly eventEmitter: EventEmitter2,
    private readonly streamEngine: StreamEngine,
  ) {}

  async startActivity(
    userId: string,
    dto: ActivityStartDto,
  ): Promise<ModuleSession> {
    const now = new Date();
    const session = this.repo.create({
      userId,
      activityType: dto.activityType,
      activityRefId: dto.activityRefId,
      status: SessionStatus.ACTIVE,
      startedAt: now,
      lastActivityAt: now,
    });
    const saved = await this.repo.save(session);

    const state: ActivityState = {
      sessionId: saved.id,
      activityType: saved.activityType,
      activityRefId: saved.activityRefId,
      startedAt: saved.startedAt,
      lastActivityAt: saved.lastActivityAt,
      isPaused: false,
    };
    this.activitySessionStore.set(userId, state);

    this.streamEngine.push(saved.id, {
      timestamp: Date.now(),
      data: {
        dataType: StreamDataType.SESSION_EVENT,
        event: StreamSessionEvent.STARTED,
      },
    });

    this.logger.log(
      `Session started: userId=${userId} sessionId=${saved.id} activityType=${saved.activityType}`,
    );

    return saved;
  }

  async endActivity(userId: string): Promise<ModuleSession | null> {
    const state = this.activitySessionStore.get(userId);
    if (!state) {
      this.logger.warn(
        `endActivity: no active session in memory for userId=${userId}`,
      );
      return null;
    }

    this.logger.debug(
      `endActivity: found state for userId=${userId} sessionId=${state.sessionId}`,
    );

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: state.sessionId } });
    if (!session) {
      this.logger.warn(
        `endActivity: sessionId=${state.sessionId} not found in DB — clearing state`,
      );
      this.activitySessionStore.delete(userId);
      return null;
    }

    this.logger.debug(
      `endActivity: DB session status=${session.status} startedAt=${session.startedAt.toISOString()}`,
    );

    session.status = SessionStatus.COMPLETED;
    session.endedAt = now;
    const saved = await this.repo.save(session);

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: {
        dataType: StreamDataType.SESSION_EVENT,
        event: StreamSessionEvent.ENDED,
      },
    });

    this.activitySessionStore.delete(userId);
    const durationMs = saved.endedAt
      ? saved.endedAt.getTime() - saved.startedAt.getTime()
      : 0;
    this.logger.log(
      `Session ended: userId=${userId} sessionId=${saved.id} durationMs=${durationMs}`,
    );

    this.logger.debug(
      `Emitting session.completed: userId=${userId} sessionId=${saved.id}`,
    );
    this.eventEmitter.emit(SessionEvents.COMPLETED, {
      sessionId: saved.id,
      userId,
      startedAt: saved.startedAt,
      endedAt: saved.endedAt,
      activityType: saved.activityType,
      activityRefId: saved.activityRefId,
    });

    return saved;
  }

  async onDisconnect(userId: string): Promise<void> {
    const state = this.activitySessionStore.get(userId);
    if (!state) return;

    const now = new Date();
    await this.repo.update(state.sessionId, {
      status: SessionStatus.DISCONNECTED,
      disconnectedAt: now,
    });
    this.logger.log(
      `Session disconnected: userId=${userId} sessionId=${state.sessionId}`,
    );
    // Entry stays in activitySessionStore — grace timer + abandon handled by handleTransportDisconnect
  }

  async abandonActivity(userId: string): Promise<void> {
    const state = this.activitySessionStore.get(userId);
    if (!state) return;

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: state.sessionId } });
    if (!session) {
      this.activitySessionStore.delete(userId);
      return;
    }

    // Guard: if the session was already resumed (ACTIVE) before the grace timer
    // fired, do not overwrite it — the user reconnected in time.
    if (session.status !== SessionStatus.DISCONNECTED) {
      this.activitySessionStore.delete(userId);
      return;
    }

    session.status = SessionStatus.ABANDONED;
    session.endedAt = now;
    const saved = await this.repo.save(session);

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: {
        dataType: StreamDataType.SESSION_EVENT,
        event: StreamSessionEvent.ABANDONED,
      },
    });

    this.activitySessionStore.delete(userId);
    this.logger.log(
      `Session abandoned: userId=${userId} sessionId=${saved.id} durationMs=${saved.endedAt ? saved.endedAt.getTime() - saved.startedAt.getTime() : 0}`,
    );

    this.eventEmitter.emit(SessionEvents.ABANDONED, {
      sessionId: saved.id,
      userId,
      startedAt: saved.startedAt,
      endedAt: saved.endedAt,
      activityType: saved.activityType,
      activityRefId: saved.activityRefId,
    });
  }

  async stopActivity(userId: string): Promise<ModuleSession | null> {
    const state = this.activitySessionStore.get(userId);
    if (!state) {
      this.logger.warn(
        `stopActivity: no active session in memory for userId=${userId}`,
      );
      return null;
    }

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: state.sessionId } });
    if (!session) {
      this.logger.warn(
        `stopActivity: sessionId=${state.sessionId} not found in DB — clearing state`,
      );
      this.activitySessionStore.delete(userId);
      return null;
    }

    session.status = SessionStatus.INTERRUPTED;
    session.endedAt = now;
    const saved = await this.repo.save(session);

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: {
        dataType: StreamDataType.SESSION_EVENT,
        event: StreamSessionEvent.INTERRUPTED,
      },
    });

    this.activitySessionStore.delete(userId);
    const durationMs = saved.endedAt
      ? saved.endedAt.getTime() - saved.startedAt.getTime()
      : 0;
    this.logger.log(
      `Session interrupted: userId=${userId} sessionId=${saved.id} durationMs=${durationMs}`,
    );

    this.eventEmitter.emit(SessionEvents.INTERRUPTED, {
      sessionId: saved.id,
      userId,
      startedAt: saved.startedAt,
      endedAt: saved.endedAt,
      activityType: saved.activityType,
      activityRefId: saved.activityRefId,
    });

    return saved;
  }

  pauseActivity(userId: string): ActivityState {
    const state = this.activitySessionStore.get(userId);
    if (!state) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    if (state.isPaused) {
      throw new Error(WsErrorCode.ALREADY_PAUSED);
    }

    state.isPaused = true;
    state.lastActivityAt = new Date();

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: {
        dataType: StreamDataType.SESSION_EVENT,
        event: StreamSessionEvent.PAUSED,
      },
    });

    this.eventEmitter.emit(MODULE_SESSION_PAUSED, {
      sessionId: state.sessionId,
      userId,
    });

    this.logger.log(
      `Session paused: userId=${userId} sessionId=${state.sessionId}`,
    );

    return state;
  }

  unpauseActivity(userId: string): ActivityState {
    const state = this.activitySessionStore.get(userId);
    if (!state) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    if (!state.isPaused) {
      throw new Error(WsErrorCode.NOT_PAUSED);
    }

    state.isPaused = false;
    state.lastActivityAt = new Date();

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: {
        dataType: StreamDataType.SESSION_EVENT,
        event: StreamSessionEvent.RESUMED,
      },
    });

    this.eventEmitter.emit(MODULE_SESSION_UNPAUSED, {
      sessionId: state.sessionId,
      userId,
    });

    this.logger.log(
      `Session unpaused: userId=${userId} sessionId=${state.sessionId}`,
    );

    return state;
  }

  getActiveSession(userId: string): ActivityState | undefined {
    return this.activitySessionStore.get(userId);
  }

  async resumeActivity(userId: string): Promise<ModuleSession | null> {
    const state = this.activitySessionStore.get(userId);
    if (!state) return null;

    const session = await this.repo.findOne({ where: { id: state.sessionId } });
    if (!session) {
      this.activitySessionStore.delete(userId);
      return null;
    }

    const now = new Date();
    const downtimeMs = session.disconnectedAt
      ? now.getTime() - session.disconnectedAt.getTime()
      : 0;
    session.status = SessionStatus.ACTIVE;
    session.disconnectedAt = null;
    session.lastActivityAt = now;
    const saved = await this.repo.save(session);
    state.lastActivityAt = now;
    state.isPaused = false;
    this.logger.log(
      `Session resumed: userId=${userId} sessionId=${saved.id} downtimeMs=${downtimeMs}`,
    );
    return saved;
  }

  async handleReconnect(userId: string): Promise<ModuleSession | null> {
    if (!this.activitySessionStore.has(userId)) return null;
    this.activitySessionStore.cancelGraceTimer(userId);
    return this.resumeActivity(userId);
  }

  async handleTransportDisconnect(userId: string): Promise<void> {
    await this.onDisconnect(userId);
    if (this.activitySessionStore.has(userId)) {
      this.activitySessionStore.startGraceTimer(userId, () => {
        this.abandonActivity(userId).catch((err: unknown) => {
          this.logger.error(
            `Failed to abandon session after grace: userId=${userId}`,
            err,
          );
        });
      });
    }
  }
}
