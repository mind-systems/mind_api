import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CHANGE_EVENT_LOGGED } from 'src/changelog';
import type { ChangeEventPayload } from 'src/changelog';

export type PushCallback = (events: LiveEvent[]) => void;

export interface LiveEvent {
  id: number;
  entity: string;
  refId: string;
  action: string;
}

interface PendingEntry {
  timer: NodeJS.Timeout;
  events: LiveEvent[];
}

interface UserEntry {
  callbacks: Set<PushCallback>;
  pending: PendingEntry | null;
}

@Injectable()
export class SyncStreamService implements OnModuleDestroy {
  private readonly streams = new Map<string, UserEntry>();

  register(userId: string, push: PushCallback): void {
    let entry = this.streams.get(userId);
    if (!entry) {
      entry = { callbacks: new Set(), pending: null };
      this.streams.set(userId, entry);
    }
    entry.callbacks.add(push);
  }

  deregister(userId: string, push: PushCallback): void {
    const entry = this.streams.get(userId);
    if (!entry) return;
    entry.callbacks.delete(push);
    if (entry.callbacks.size === 0) {
      if (entry.pending) {
        clearTimeout(entry.pending.timer);
      }
      this.streams.delete(userId);
    }
  }

  @OnEvent(CHANGE_EVENT_LOGGED)
  onChangeLogged(payload: ChangeEventPayload): void {
    const { id, entity, refId, action, userId } = payload;
    const entry = this.streams.get(userId);
    if (!entry) return;

    if (entry.pending) {
      entry.pending.events.push({ id, entity, refId, action });
    } else {
      const timer = setTimeout(() => this.flush(userId), 300);
      entry.pending = { timer, events: [{ id, entity, refId, action }] };
    }
  }

  private flush(userId: string): void {
    const entry = this.streams.get(userId);
    if (!entry?.pending) return;

    const { events } = entry.pending;
    entry.pending = null;
    for (const push of entry.callbacks) {
      push(events);
    }
  }

  onModuleDestroy(): void {
    for (const entry of this.streams.values()) {
      if (entry.pending) {
        clearTimeout(entry.pending.timer);
      }
    }
    this.streams.clear();
  }
}
