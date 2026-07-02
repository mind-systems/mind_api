export const StreamDataType = {
  SESSION_EVENT: 'session_event',
  BREATH_PHASE: 'breath_phase',
} as const;

export const StreamSessionEvent = {
  STARTED: 'session_started',
  ENDED: 'session_ended',
  ABANDONED: 'session_abandoned',
  INTERRUPTED: 'session_interrupted',
  PAUSED: 'paused',
  RESUMED: 'resumed',
  DISCONNECTED: 'disconnected',
  RECONNECTED: 'reconnected',
} as const;
