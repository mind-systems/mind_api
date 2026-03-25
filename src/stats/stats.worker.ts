import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StatsService } from './stats.service';
import type { SessionEvent } from './stats.service';
import { SessionEvents } from '../realtime/events/session.events';

@Injectable()
export class StatsWorker {
  private readonly logger = new Logger(StatsWorker.name);

  constructor(private readonly statsService: StatsService) {}

  @OnEvent(SessionEvents.COMPLETED)
  async onSessionCompleted(event: SessionEvent): Promise<void> {
    const durationMs = event.endedAt.getTime() - event.startedAt.getTime();
    this.logger.log(
      `Stats finalising: userId=${event.userId} sessionId=${event.sessionId} durationMs=${durationMs}`,
    );
    try {
      await this.statsService.finalise(event);
      this.logger.log(
        `Stats finalised OK: userId=${event.userId} sessionId=${event.sessionId}`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Stats finalise FAILED: userId=${event.userId} sessionId=${event.sessionId}`,
        err,
      );
    }
  }

  @OnEvent(SessionEvents.ABANDONED)
  async onSessionAbandoned(event: SessionEvent): Promise<void> {
    const durationMs = event.endedAt.getTime() - event.startedAt.getTime();
    this.logger.log(
      `Stats finalising: userId=${event.userId} sessionId=${event.sessionId} durationMs=${durationMs}`,
    );
    try {
      await this.statsService.finalise(event);
      this.logger.log(
        `Stats finalised OK: userId=${event.userId} sessionId=${event.sessionId}`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Stats finalise FAILED: userId=${event.userId} sessionId=${event.sessionId}`,
        err,
      );
    }
  }

  @OnEvent(SessionEvents.INTERRUPTED)
  async onSessionInterrupted(event: SessionEvent): Promise<void> {
    const durationMs = event.endedAt.getTime() - event.startedAt.getTime();
    this.logger.log(
      `Stats finalising: userId=${event.userId} sessionId=${event.sessionId} durationMs=${durationMs}`,
    );
    try {
      await this.statsService.finalise(event);
      this.logger.log(
        `Stats finalised OK: userId=${event.userId} sessionId=${event.sessionId}`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Stats finalise FAILED: userId=${event.userId} sessionId=${event.sessionId}`,
        err,
      );
    }
  }
}
