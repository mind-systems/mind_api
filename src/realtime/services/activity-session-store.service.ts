import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityState } from '../interfaces/activity-state.interface';

const DEFAULT_GRACE_MS = 30_000;

@Injectable()
export class ActivitySessionStore {
  private readonly activityMap = new Map<string, ActivityState>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly graceMs: number;

  constructor(private readonly configService: ConfigService) {
    this.graceMs =
      this.configService.get<number>('WS_RECONNECT_GRACE_MS') ??
      DEFAULT_GRACE_MS;
  }

  get(userId: string): ActivityState | undefined {
    return this.activityMap.get(userId);
  }

  has(userId: string): boolean {
    return this.activityMap.has(userId);
  }

  set(userId: string, state: ActivityState): void {
    this.activityMap.set(userId, state);
  }

  delete(userId: string): boolean {
    return this.activityMap.delete(userId);
  }

  get size(): number {
    return this.activityMap.size;
  }

  startGraceTimer(userId: string, onExpiry: () => void | Promise<void>): void {
    this.cancelGraceTimer(userId);
    const handle = setTimeout(() => {
      this.timers.delete(userId);
      void onExpiry();
    }, this.graceMs);
    this.timers.set(userId, handle);
  }

  cancelGraceTimer(userId: string): void {
    const handle = this.timers.get(userId);
    if (handle === undefined) return;
    clearTimeout(handle);
    this.timers.delete(userId);
  }

  hasPendingGraceTimer(userId: string): boolean {
    return this.timers.has(userId);
  }
}
