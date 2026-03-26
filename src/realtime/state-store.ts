import { Injectable } from '@nestjs/common';
import { PresenceState } from './interfaces/presence-state.interface';

@Injectable()
export class StateStore {
  readonly presenceMap = new Map<string, PresenceState>();
}
