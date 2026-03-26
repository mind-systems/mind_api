import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subscriber } from 'rxjs';

@Injectable()
export class ActiveStreamRegistry implements OnModuleDestroy {
  private readonly streams = new Map<string, Set<Subscriber<any>>>();

  get size(): number {
    let count = 0;
    for (const set of this.streams.values()) {
      count += set.size;
    }
    return count;
  }

  register(userId: string, subscriber: Subscriber<any>): void {
    let set = this.streams.get(userId);
    if (!set) {
      set = new Set();
      this.streams.set(userId, set);
    }
    set.add(subscriber);
  }

  deregister(userId: string, subscriber: Subscriber<any>): void {
    const set = this.streams.get(userId);
    if (!set) return;
    set.delete(subscriber);
    if (set.size === 0) {
      this.streams.delete(userId);
    }
  }

  closeAll(userId: string): void {
    const set = this.streams.get(userId);
    if (!set) return;
    for (const subscriber of set) {
      subscriber.complete();
    }
    this.streams.delete(userId);
  }

  onModuleDestroy(): void {
    for (const set of this.streams.values()) {
      for (const subscriber of set) {
        subscriber.complete();
      }
    }
    this.streams.clear();
  }
}
