import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { StateStore } from '../state-store';

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(private readonly stateStore: StateStore) {}

  @Interval(60_000)
  logMetrics(): void {
    const activeSessions = this.stateStore.activityMap.size;
    const connectedSockets = this.stateStore.socketMap.size;
    const connectedStreams = this.stateStore.streamMap.size;
    this.logger.log(
      `Realtime metrics: activeSessions=${activeSessions} connectedSockets=${connectedSockets} connectedStreams=${connectedStreams}`,
    );
  }
}
