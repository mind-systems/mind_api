import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Socket } from 'socket.io';
import { StateStore } from '../state-store';
import { CHANGE_EVENT_LOGGED } from 'src/changelog';
import type { ChangeEventPayload } from 'src/changelog';
import { SYNC_CHANGED } from '../events/live.events';

interface PendingEntry {
  timer: NodeJS.Timeout;
  events: Array<{ id: number; entity: string; refId: string; action: string }>;
}

@Injectable()
export class SyncNotifierService implements OnModuleDestroy {
  private readonly logger = new Logger(SyncNotifierService.name);
  private readonly pending = new Map<string, PendingEntry>();

  constructor(private readonly stateStore: StateStore) {}

  @OnEvent(CHANGE_EVENT_LOGGED)
  onChangeLogged(payload: ChangeEventPayload): void {
    const { id, entity, refId, action, userId } = payload;

    if (!this.stateStore.socketMap.has(userId)) {
      return;
    }

    const existing = this.pending.get(userId);
    if (existing) {
      existing.events.push({ id, entity, refId, action });
    } else {
      const timer = setTimeout(() => this.flush(userId), 300);
      this.pending.set(userId, {
        timer,
        events: [{ id, entity, refId, action }],
      });
    }
  }

  private flush(userId: string): void {
    const entry = this.pending.get(userId);
    if (!entry) return;

    this.pending.delete(userId);

    const socket = this.stateStore.socketMap.get(userId);
    if (!socket) return;

    (socket as Socket).emit(SYNC_CHANGED, { events: entry.events });
    this.logger.debug(
      `sync:changed pushed to userId=${userId} events=${entry.events.length}`,
    );
  }

  onModuleDestroy(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }
}
