import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModuleSession } from '../entities/module-session.entity';
import { ActivitySessionStore } from './activity-session-store.service';
import { ActivityState } from '../interfaces/activity-state.interface';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { ActivityType } from '../enums/activity-type.enum';
import { SessionStatus } from '../enums/session-status.enum';
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

  private readonly ensureRootInFlight = new Map<
    string,
    Promise<ModuleSession>
  >();

  constructor(
    @InjectRepository(ModuleSession)
    private readonly repo: Repository<ModuleSession>,
    private readonly activitySessionStore: ActivitySessionStore,
    private readonly eventEmitter: EventEmitter2,
    private readonly streamEngine: StreamEngine,
  ) {}

  /** Push a discrete SESSION_EVENT marker. `serverMarker: true` is never set
   *  by the gRPC controller, so it reliably marks this as server-originated
   *  for StreamEngine.push()'s immediate-persist branch. */
  private pushSessionEventMarker(
    sessionId: string,
    event: string,
    timestampMs?: number,
  ): void {
    this.streamEngine.push(sessionId, {
      timestamp: timestampMs ?? Date.now(),
      serverMarker: true,
      data: {
        dataType: StreamDataType.SESSION_EVENT,
        event,
      },
    });
  }

  /**
   * Coerce a client-supplied timestamp (may be number, Long, or string from
   * ts-proto int64 fields) into a Date.  Returns null when the value is absent,
   * zero, NaN, or non-finite — callers fall back to server now().
   */
  private coerceClientTs(
    clientTimestampMs?: number | { toNumber?: () => number } | string,
  ): Date | null {
    if (clientTimestampMs === undefined || clientTimestampMs === null) {
      return null;
    }
    const ms =
      typeof clientTimestampMs === 'object' &&
      typeof clientTimestampMs.toNumber === 'function'
        ? (clientTimestampMs as { toNumber: () => number }).toNumber()
        : Number(clientTimestampMs);
    if (!ms || !isFinite(ms)) {
      return null;
    }
    return new Date(ms);
  }

  /** Remove a session from the store, using root or child removal as
   *  appropriate. Dormant root branch is correct for future phases. */
  private removeSessionFromStore(userId: string, sessionId: string): void {
    if (sessionId === this.activitySessionStore.getRootId(userId)) {
      this.activitySessionStore.removeRoot(userId);
    } else {
      this.activitySessionStore.removeChild(userId, sessionId);
    }
  }

  /**
   * Synthesize a root ModuleSession from in-memory state without touching the
   * DB. Returns null when the store has no rootSessionId recorded for the user
   * (defensive branch — callers fall through to the create path).
   */
  private reconstructRoot(
    userId: string,
    state: ActivityState,
  ): ModuleSession | null {
    const rootId = this.activitySessionStore.getRootId(userId);
    if (!rootId) return null;
    return {
      id: rootId,
      userId,
      activityType: ActivityType.ROOT,
      activityRefId: undefined,
      rootSessionId: null,
      status: SessionStatus.ACTIVE,
      startedAt: state.startedAt,
      lastActivityAt: state.lastActivityAt,
    } as ModuleSession;
  }

  /**
   * Materialize a lazy root ModuleSession for a user connection.
   * Idempotent: if a root is already in the store, returns a synthesized
   * ModuleSession with no DB access (no repo.create, no repo.save).
   * On first call, persists a new root row and registers it in the store.
   */
  async ensureRoot(
    userId: string,
    clientTimestampMs?: number | { toNumber?: () => number } | string,
  ): Promise<ModuleSession> {
    // Fast path: root already in store — no lock needed.
    const existingRootState = this.activitySessionStore.getRoot(userId);
    if (existingRootState) {
      const r = this.reconstructRoot(userId, existingRootState);
      if (r) return r;
    }

    // Join path: a concurrent call for the same user is already creating the
    // root — piggyback on its promise instead of racing to create a second row.
    const inflight = this.ensureRootInFlight.get(userId);
    if (inflight) return inflight;

    // Critical section: one caller reaches here at a time (per userId) because
    // the promise is registered synchronously before the first await.
    const p = (async () => {
      // Re-check after acquiring the lock in case another call completed between
      // the fast-path miss above and this point.
      const recheckState = this.activitySessionStore.getRoot(userId);
      if (recheckState) {
        const r = this.reconstructRoot(userId, recheckState);
        if (r) return r;
      }

      const now = new Date();
      const session = this.repo.create({
        userId,
        activityType: ActivityType.ROOT,
        activityRefId: undefined,
        status: SessionStatus.ACTIVE,
        startedAt: this.coerceClientTs(clientTimestampMs) ?? now,
        lastActivityAt: now,
        rootSessionId: null,
      });
      const saved = await this.repo.save(session);

      this.activitySessionStore.setRoot(userId, saved.id, {
        sessionId: saved.id,
        activityType: ActivityType.ROOT,
        startedAt: saved.startedAt,
        lastActivityAt: saved.lastActivityAt,
        isPaused: false,
        rootSessionId: null,
      });

      this.logger.log(
        `Root session created: userId=${userId} rootSessionId=${saved.id}`,
      );

      return saved;
    })();

    this.ensureRootInFlight.set(userId, p);
    try {
      return await p;
    } finally {
      this.ensureRootInFlight.delete(userId);
    }
  }

  async startActivity(
    userId: string,
    dto: ActivityStartDto,
  ): Promise<ModuleSession> {
    const rootId = this.activitySessionStore.getRootId(userId);
    const now = new Date();
    const startedAt = this.coerceClientTs(dto.clientTimestampMs) ?? now;
    const session = this.repo.create({
      userId,
      activityType: dto.activityType,
      activityRefId: dto.activityRefId,
      status: SessionStatus.ACTIVE,
      startedAt,
      lastActivityAt: now,
      rootSessionId: rootId,
    });
    session.rootSessionId = rootId;
    const saved = await this.repo.save(session);

    const state: ActivityState = {
      sessionId: saved.id,
      activityType: saved.activityType,
      activityRefId: saved.activityRefId,
      startedAt: saved.startedAt,
      lastActivityAt: saved.lastActivityAt,
      isPaused: false,
      rootSessionId: rootId,
    };
    this.activitySessionStore.addChild(userId, saved.id, state);

    this.pushSessionEventMarker(saved.id, StreamSessionEvent.STARTED);

    this.logger.log(
      `Session started: userId=${userId} sessionId=${saved.id} activityType=${saved.activityType}`,
    );

    return saved;
  }

  /** sessionId is the 2nd positional arg; clientTimestampMs is 3rd.
   *  Reordered so session_id routing can be threaded without breaking the timestamp slot. */
  async endActivity(
    userId: string,
    sessionId?: string,
    clientTimestampMs?: number | { toNumber?: () => number } | string,
  ): Promise<ModuleSession | null> {
    const sid =
      sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;
    if (!sid) {
      this.logger.warn(
        `endActivity: no resolvable session id for userId=${userId}`,
      );
      return null;
    }

    const state = this.activitySessionStore.getSession(userId, sid);
    if (!state) {
      this.logger.warn(
        `endActivity: session ${sid} not in memory for userId=${userId}`,
      );
      return null;
    }

    if (
      sid === this.activitySessionStore.getRootId(userId) ||
      state.activityType === ActivityType.ROOT
    ) {
      this.logger.warn(
        `endActivity: cannot end root session for userId=${userId} sessionId=${sid}`,
      );
      return null;
    }

    this.logger.debug(
      `endActivity: found state for userId=${userId} sessionId=${sid}`,
    );

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: sid } });
    if (!session) {
      this.logger.warn(
        `endActivity: sessionId=${sid} not found in DB — clearing state`,
      );
      this.removeSessionFromStore(userId, sid);
      return null;
    }

    this.logger.debug(
      `endActivity: DB session status=${session.status} startedAt=${session.startedAt.toISOString()}`,
    );

    const clientEnd = this.coerceClientTs(clientTimestampMs);
    const endedAt =
      clientEnd && clientEnd.getTime() >= session.startedAt.getTime()
        ? clientEnd
        : now;

    session.status = SessionStatus.COMPLETED;
    session.endedAt = endedAt;
    const saved = await this.repo.save(session);

    this.pushSessionEventMarker(sid, StreamSessionEvent.ENDED);

    this.removeSessionFromStore(userId, sid);
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

  async onDisconnect(userId: string, sessionId?: string): Promise<void> {
    const sid =
      sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;
    if (!sid) return;

    const state = this.activitySessionStore.getSession(userId, sid);
    if (!state) return;

    const now = new Date();
    await this.repo.update(sid, {
      status: SessionStatus.DISCONNECTED,
      disconnectedAt: now,
    });
    this.logger.log(`Session disconnected: userId=${userId} sessionId=${sid}`);
    // Entry stays in activitySessionStore — grace timer + abandon handled by handleTransportDisconnect
  }

  async abandonActivity(userId: string, sessionId?: string): Promise<void> {
    const sid =
      sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;
    if (!sid) return;

    const state = this.activitySessionStore.getSession(userId, sid);
    if (!state) return;

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: sid } });
    if (!session) {
      this.removeSessionFromStore(userId, sid);
      return;
    }

    // Guard: if the session was already resumed (ACTIVE) before the grace timer
    // fired, do not overwrite it — the user reconnected in time.
    if (session.status !== SessionStatus.DISCONNECTED) {
      this.removeSessionFromStore(userId, sid);
      return;
    }

    session.status = SessionStatus.ABANDONED;
    session.endedAt = session.disconnectedAt ?? now;
    const saved = await this.repo.save(session);

    this.pushSessionEventMarker(sid, StreamSessionEvent.ABANDONED);

    this.removeSessionFromStore(userId, sid);
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

  async abandonStale(userId: string, sessionId: string): Promise<void> {
    const session = await this.repo.findOne({ where: { id: sessionId } });
    if (!session) {
      if (this.activitySessionStore.getSession(userId, sessionId)) {
        this.removeSessionFromStore(userId, sessionId);
      }
      return;
    }

    const finalStatuses: SessionStatus[] = [
      SessionStatus.COMPLETED,
      SessionStatus.INTERRUPTED,
      SessionStatus.ABANDONED,
    ];
    if (finalStatuses.includes(session.status)) {
      if (this.activitySessionStore.getSession(userId, sessionId)) {
        this.removeSessionFromStore(userId, sessionId);
      }
      return;
    }

    const now = new Date();
    session.status = SessionStatus.ABANDONED;
    session.endedAt = now;
    const saved = await this.repo.save(session);

    this.pushSessionEventMarker(sessionId, StreamSessionEvent.ABANDONED);

    if (this.activitySessionStore.getSession(userId, sessionId)) {
      this.removeSessionFromStore(userId, sessionId);
    }
    this.logger.log(
      `Session abandoned (stale): userId=${userId} sessionId=${saved.id} durationMs=${saved.endedAt ? saved.endedAt.getTime() - saved.startedAt.getTime() : 0}`,
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

  async stopActivity(
    userId: string,
    sessionId?: string,
  ): Promise<ModuleSession | null> {
    const sid =
      sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;
    if (!sid) {
      this.logger.warn(
        `stopActivity: no active session in memory for userId=${userId}`,
      );
      return null;
    }

    const state = this.activitySessionStore.getSession(userId, sid);
    if (!state) {
      this.logger.warn(
        `stopActivity: no active session in memory for userId=${userId}`,
      );
      return null;
    }

    if (
      sid === this.activitySessionStore.getRootId(userId) ||
      state.activityType === ActivityType.ROOT
    ) {
      this.logger.warn(
        `stopActivity: cannot stop root session for userId=${userId} sessionId=${sid}`,
      );
      return null;
    }

    const now = new Date();
    const session = await this.repo.findOne({ where: { id: sid } });
    if (!session) {
      this.logger.warn(
        `stopActivity: sessionId=${sid} not found in DB — clearing state`,
      );
      this.removeSessionFromStore(userId, sid);
      return null;
    }

    try {
      session.status = SessionStatus.INTERRUPTED;
      session.endedAt = now;
      const saved = await this.repo.save(session);

      this.pushSessionEventMarker(sid, StreamSessionEvent.INTERRUPTED);

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
    } finally {
      this.removeSessionFromStore(userId, sid);
    }
  }

  pauseActivity(userId: string, sessionId?: string): ActivityState {
    const sid =
      sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;
    if (!sid) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    const state = this.activitySessionStore.getSession(userId, sid);
    if (!state) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    if (
      sid === this.activitySessionStore.getRootId(userId) ||
      state.activityType === ActivityType.ROOT
    ) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    if (state.isPaused) {
      throw new Error(WsErrorCode.ALREADY_PAUSED);
    }

    state.isPaused = true;
    state.lastActivityAt = new Date();

    this.pushSessionEventMarker(sid, StreamSessionEvent.PAUSED);

    this.eventEmitter.emit(MODULE_SESSION_PAUSED, {
      sessionId: sid,
      userId,
    });

    this.logger.log(`Session paused: userId=${userId} sessionId=${sid}`);

    return state;
  }

  unpauseActivity(userId: string, sessionId?: string): ActivityState {
    const sid =
      sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;
    if (!sid) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    const state = this.activitySessionStore.getSession(userId, sid);
    if (!state) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    if (
      sid === this.activitySessionStore.getRootId(userId) ||
      state.activityType === ActivityType.ROOT
    ) {
      throw new Error(WsErrorCode.NO_ACTIVE_SESSION);
    }
    if (!state.isPaused) {
      throw new Error(WsErrorCode.NOT_PAUSED);
    }

    state.isPaused = false;
    state.lastActivityAt = new Date();

    this.pushSessionEventMarker(sid, StreamSessionEvent.RESUMED);

    this.eventEmitter.emit(MODULE_SESSION_UNPAUSED, {
      sessionId: sid,
      userId,
    });

    this.logger.log(`Session unpaused: userId=${userId} sessionId=${sid}`);

    return state;
  }

  getActiveSession(userId: string): ActivityState | undefined {
    return this.activitySessionStore.getSoleChild(userId);
  }

  getSession(userId: string, sessionId: string): ActivityState | undefined {
    return this.activitySessionStore.getSession(userId, sessionId);
  }

  getSoleChild(userId: string): ActivityState | undefined {
    return this.activitySessionStore.getSoleChild(userId);
  }

  getRootId(userId: string): string | null {
    return this.activitySessionStore.getRootId(userId);
  }

  listChildren(userId: string): ActivityState[] {
    return this.activitySessionStore.listChildren(userId);
  }

  listLiveSessions(userId: string): ActivityState[] {
    const root = this.activitySessionStore.getRoot(userId);
    const children = this.activitySessionStore.listChildren(userId);
    return root ? [root, ...children] : [...children];
  }

  async resumeActivity(
    userId: string,
    sessionId?: string,
  ): Promise<ModuleSession | null> {
    const sid =
      sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;
    if (!sid) return null;

    const state = this.activitySessionStore.getSession(userId, sid);
    if (!state) return null;

    const session = await this.repo.findOne({ where: { id: sid } });
    if (!session) {
      this.removeSessionFromStore(userId, sid);
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
    this.logger.log(
      `Session resumed: userId=${userId} sessionId=${saved.id} downtimeMs=${downtimeMs}`,
    );
    return saved;
  }

  async handleReconnect(
    userId: string,
    clientSessionId?: string,
  ): Promise<ModuleSession | { abandoned: true } | null> {
    const rootId = this.activitySessionStore.getRootId(userId);
    const childIds = this.activitySessionStore
      .listChildren(userId)
      .map((c) => c.sessionId);
    const sessionIds = ([rootId, ...childIds] as (string | null)[]).filter(
      (id): id is string => Boolean(id),
    );

    if (sessionIds.length > 0) {
      let soleChildResult: ModuleSession | null = null;
      let rootResult: ModuleSession | null = null;

      const reconnectedAt = Date.now();
      for (const sid of sessionIds) {
        this.activitySessionStore.cancelGraceTimerForSession(sid);
        const resumed = await this.resumeActivity(userId, sid);
        if (sid === rootId) {
          rootResult = resumed;
        } else {
          soleChildResult = resumed;
        }
      }

      if (rootId && rootResult) {
        this.pushSessionEventMarker(
          rootId,
          StreamSessionEvent.RECONNECTED,
          reconnectedAt,
        );
      }

      return soleChildResult ?? rootResult ?? null;
    }

    if (clientSessionId) {
      const row = await this.repo.findOne({
        where: { id: clientSessionId, userId },
      });
      if (row?.status === SessionStatus.ABANDONED) {
        this.logger.log(
          `Session abandonment confirmed on reconnect: userId=${userId} sessionId=${clientSessionId}`,
        );
        return { abandoned: true };
      }
    }
    return null;
  }

  async handleTransportDisconnect(userId: string): Promise<void> {
    const rootId = this.activitySessionStore.getRootId(userId);
    const childIds = this.activitySessionStore
      .listChildren(userId)
      .map((c) => c.sessionId);
    const sessionIds = ([rootId, ...childIds] as (string | null)[]).filter(
      (id): id is string => Boolean(id),
    );
    const disconnectedAt = Date.now();

    for (const sid of sessionIds) {
      await this.onDisconnect(userId, sid);
      this.activitySessionStore.startGraceTimerForSession(sid, () => {
        this.abandonActivity(userId, sid).catch((err: unknown) => {
          this.logger.error(
            `Failed to abandon session after grace: userId=${userId} sessionId=${sid}`,
            err,
          );
        });
      });
    }

    if (rootId) {
      this.pushSessionEventMarker(
        rootId,
        StreamSessionEvent.DISCONNECTED,
        disconnectedAt,
      );
    }
  }

  async supersedeChildren(userId: string): Promise<void> {
    const children = this.activitySessionStore.listChildren(userId);
    // Clear the store SYNCHRONOUSLY, before any DB await — see spec §Safety-2.
    for (const child of children) {
      this.activitySessionStore.removeChild(userId, child.sessionId);
    }
    const now = new Date();
    for (const child of children) {
      const session = await this.repo.findOne({
        where: { id: child.sessionId },
      });
      if (!session) continue; // already gone from DB — nothing to persist
      session.status = SessionStatus.INTERRUPTED;
      session.endedAt = now;
      const saved = await this.repo.save(session);
      this.pushSessionEventMarker(saved.id, StreamSessionEvent.INTERRUPTED);
      this.eventEmitter.emit(SessionEvents.INTERRUPTED, {
        sessionId: saved.id,
        userId,
        startedAt: saved.startedAt,
        endedAt: saved.endedAt,
        activityType: saved.activityType,
        activityRefId: saved.activityRefId,
      });
    }
    this.logger.log(
      `Sessions superseded (eviction takeover): userId=${userId} count=${children.length}`,
    );
  }
}
