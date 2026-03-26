import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { StateStore } from '../state-store';
import { ActivitySessionStore } from './activity-session-store.service';

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(
    private readonly stateStore: StateStore,
    private readonly activitySessionStore: ActivitySessionStore,
  ) {}

  @Interval(60_000)
  logMetrics(): void {
    const activeSessions = this.activitySessionStore.size;
    const connectedStreams = this.stateStore.streamMap.size;
    this.logger.log(
      `Realtime metrics: activeSessions=${activeSessions} connectedStreams=${connectedStreams}`,
    );
  }
}
