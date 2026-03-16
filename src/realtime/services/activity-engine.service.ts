import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LiveSession } from '../entities/live-session.entity';
import { StateStore } from '../state-store';
import { ActivityState } from '../interfaces/activity-state.interface';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityType } from '../enums/activity-type.enum';
import { StreamEngine } from './stream-engine.service';
import {
  LIVE_SESSION_PAUSED,
  LIVE_SESSION_UNPAUSED,
} from '../events/live.events';

@Injectable()
export class ActivityEngine {
  private readonly logger = new Logger(ActivityEngine.name);

  constructor(
    @InjectRepository(LiveSession)
    private readonly repo: Repository<LiveSession>,
    private readonly stateStore: StateStore,
    private readonly eventEmitter: EventEmitter2,
    private readonly streamEngine: StreamEngine,
  ) {}

  async startActivity(
    userId: string,
    dto: ActivityStartDto,
  ): Promise<LiveSession> {
    const now = new Date();
    const session = this.repo.create({
      userId,
      activityType: dto.activityType,
      activityRefType: dto.activityRefType,
      activityRefId: dto.activityRefId,
      status: SessionStatus.ACTIVE,
      startedAt: now,
      lastActivityAt: now,
    });
    const saved = await this.repo.save(session);

    const state: ActivityState = {
      sessionId: saved.id,
      activityType: saved.activityType,
      activityRefType: saved.activityRefType,
      activityRefId: saved.activityRefId,
      startedAt: saved.startedAt,
      lastActivityAt: saved.lastActivityAt,
      isPaused: false,
    };
    this.stateStore.activityMap.set(userId, state);

    this.streamEngine.push(saved.id, {
      timestamp: Date.now(),
      data: { dataType: 'session_event', event: 'session_started' },
    });

    this.logger.log(
      `Session started: userId=${userId} sessionId=${saved.id} activityType=${saved.activityType}`,
    );

    return saved;
  }

  async endActivity(userId: string): Promise<LiveSession | null> {
    const state = this.stateStore.activityMap.get(userId);
    if (!state) {
      this.logger.warn(`endActivity: no active session in memory for userId=${userId}`);
      return null;
    }

    this.logger.debug(`endActivity: found state for userId=${userId} sessionId=${state.sessionId}`);

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: state.sessionId } });
    if (!session) {
      this.logger.warn(`endActivity: sessionId=${state.sessionId} not found in DB — clearing state`);
      this.stateStore.activityMap.delete(userId);
      return null;
    }

    this.logger.debug(`endActivity: DB session status=${session.status} startedAt=${session.startedAt.toISOString()}`);

    session.status = SessionStatus.COMPLETED;
    session.endedAt = now;
    const saved = await this.repo.save(session);

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: { dataType: 'session_event', event: 'session_ended' },
    });

    this.stateStore.activityMap.delete(userId);
    const durationMs = saved.endedAt ? saved.endedAt.getTime() - saved.startedAt.getTime() : 0;
    this.logger.log(
      `Session ended: userId=${userId} sessionId=${saved.id} durationMs=${durationMs}`,
    );

    this.logger.debug(`Emitting session.completed: userId=${userId} sessionId=${saved.id}`);
    this.eventEmitter.emit('session.completed', {
      sessionId: saved.id,
      userId,
      startedAt: saved.startedAt,
      endedAt: saved.endedAt,
      activityType: saved.activityType,
    });

    return saved;
  }

  async onDisconnect(userId: string): Promise<void> {
    const state = this.stateStore.activityMap.get(userId);
    if (!state) return;

    const now = new Date();
    await this.repo.update(state.sessionId, {
      status: SessionStatus.DISCONNECTED,
      disconnectedAt: now,
    });
    this.logger.log(
      `Session disconnected: userId=${userId} sessionId=${state.sessionId}`,
    );
    // Entry stays in activityMap — Phase D handles grace timer + abandon
  }

  async abandonActivity(userId: string): Promise<void> {
    const state = this.stateStore.activityMap.get(userId);
    if (!state) return;

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: state.sessionId } });
    if (!session) {
      this.stateStore.activityMap.delete(userId);
      return;
    }

    // Guard: if the session was already resumed (ACTIVE) before the grace timer
    // fired, do not overwrite it — the user reconnected in time.
    if (session.status !== SessionStatus.DISCONNECTED) {
      this.stateStore.activityMap.delete(userId);
      return;
    }

    session.status = SessionStatus.ABANDONED;
    session.endedAt = now;
    const saved = await this.repo.save(session);

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: { dataType: 'session_event', event: 'session_abandoned' },
    });

    this.stateStore.activityMap.delete(userId);
    this.logger.log(
      `Session abandoned: userId=${userId} sessionId=${saved.id} durationMs=${saved.endedAt ? saved.endedAt.getTime() - saved.startedAt.getTime() : 0}`,
    );

    this.eventEmitter.emit('session.abandoned', {
      sessionId: saved.id,
      userId,
      startedAt: saved.startedAt,
      endedAt: saved.endedAt,
      activityType: saved.activityType as ActivityType,
    });
  }

  pauseActivity(userId: string): ActivityState {
    const state = this.stateStore.activityMap.get(userId);
    if (!state) {
      throw new Error('no_active_session');
    }
    if (state.isPaused) {
      throw new Error('already_paused');
    }

    state.isPaused = true;
    state.lastActivityAt = new Date();

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: { dataType: 'session_event', event: 'paused' },
    });

    this.eventEmitter.emit(LIVE_SESSION_PAUSED, {
      sessionId: state.sessionId,
      userId,
    });

    this.logger.log(
      `Session paused: userId=${userId} sessionId=${state.sessionId}`,
    );

    return state;
  }

  unpauseActivity(userId: string): ActivityState {
    const state = this.stateStore.activityMap.get(userId);
    if (!state) {
      throw new Error('no_active_session');
    }
    if (!state.isPaused) {
      throw new Error('not_paused');
    }

    state.isPaused = false;
    state.lastActivityAt = new Date();

    this.streamEngine.push(state.sessionId, {
      timestamp: Date.now(),
      data: { dataType: 'session_event', event: 'resumed' },
    });

    this.eventEmitter.emit(LIVE_SESSION_UNPAUSED, {
      sessionId: state.sessionId,
      userId,
    });

    this.logger.log(
      `Session unpaused: userId=${userId} sessionId=${state.sessionId}`,
    );

    return state;
  }

  getActiveSession(userId: string): ActivityState | undefined {
    return this.stateStore.activityMap.get(userId);
  }

  async resumeActivity(userId: string): Promise<LiveSession | null> {
    const state = this.stateStore.activityMap.get(userId);
    if (!state) return null;

    const session = await this.repo.findOne({ where: { id: state.sessionId } });
    if (!session) {
      this.stateStore.activityMap.delete(userId);
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
}
