import { Injectable } from '@nestjs/common';
import { ServerWritableStream } from '@grpc/grpc-js';
import { PresenceState } from './interfaces/presence-state.interface';

@Injectable()
export class StateStore {
  readonly streamMap = new Map<string, ServerWritableStream<unknown, unknown>>();
  readonly presenceMap = new Map<string, PresenceState>();
}
