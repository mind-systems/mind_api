import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ActivitySessionStore } from './activity-session-store.service';
import { ActiveStreamRegistry } from './active-stream-registry.service';

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(
    private readonly activitySessionStore: ActivitySessionStore,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
  ) {}

  @Interval(60_000)
  logMetrics(): void {
    const activeSessions = this.activitySessionStore.size;
    const connectedStreams = this.activeStreamRegistry.size;
    this.logger.log(
      `Realtime metrics: activeSessions=${activeSessions} connectedStreams=${connectedStreams}`,
    );
  }
}
