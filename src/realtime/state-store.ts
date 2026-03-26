import { Injectable } from '@nestjs/common';
import { ServerWritableStream } from '@grpc/grpc-js';
import { AuthenticatedSocket } from './interfaces/authenticated-socket.interface';
import { PresenceState } from './interfaces/presence-state.interface';
import { ActivityState } from './interfaces/activity-state.interface';

@Injectable()
export class StateStore {
  readonly socketMap = new Map<string, AuthenticatedSocket>();
  readonly streamMap = new Map<string, ServerWritableStream<unknown, unknown>>();
  readonly presenceMap = new Map<string, PresenceState>();
  readonly activityMap = new Map<string, ActivityState>();
}
