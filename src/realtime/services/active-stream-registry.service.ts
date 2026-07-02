import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subscriber } from 'rxjs';
import { StreamService } from '../constants/stream-service';

@Injectable()
export class ActiveStreamRegistry implements OnModuleDestroy {
  private readonly streams = new Map<
    string,
    Map<StreamService, Subscriber<any>>
  >();
  private readonly evictedSubscribers = new WeakSet<Subscriber<any>>();

  get size(): number {
    let count = 0;
    for (const serviceMap of this.streams.values()) count += serviceMap.size;
    return count;
  }

  register(
    userId: string,
    service: StreamService,
    subscriber: Subscriber<any>,
    onEvict?: (evicted: Subscriber<any>) => void,
  ): void {
    const existing = this.streams.get(userId)?.get(service);
    if (existing && existing !== subscriber) {
      this.evictedSubscribers.add(existing);
      onEvict?.(existing); // service-specific pre-complete frame — see spec §7
      existing.complete(); // synchronous — see spec §Safety; may prune streams[userId]
    }
    // Re-fetch after eviction — the prior map may have been pruned by the
    // evicted subscriber's synchronous deregister teardown.
    let serviceMap = this.streams.get(userId);
    if (!serviceMap) {
      serviceMap = new Map();
      this.streams.set(userId, serviceMap);
    }
    serviceMap.set(service, subscriber);
  }

  deregister(
    userId: string,
    service: StreamService,
    subscriber: Subscriber<any>,
  ): boolean {
    const wasEvicted = this.evictedSubscribers.delete(subscriber);
    const serviceMap = this.streams.get(userId);
    if (serviceMap?.get(service) === subscriber) {
      serviceMap.delete(service);
      if (serviceMap.size === 0) this.streams.delete(userId);
    }
    return wasEvicted;
  }

  hasLiveSubscriber(userId: string): boolean {
    return (this.streams.get(userId)?.size ?? 0) > 0;
  }

  closeAll(userId: string): void {
    const serviceMap = this.streams.get(userId);
    if (!serviceMap) return;
    for (const subscriber of serviceMap.values()) subscriber.complete();
    this.streams.delete(userId);
  }

  onModuleDestroy(): void {
    for (const serviceMap of this.streams.values()) {
      for (const subscriber of serviceMap.values()) subscriber.complete();
    }
    this.streams.clear();
  }
}
