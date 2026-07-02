export const StreamService = {
  STATE: 'state',
  INSTRUCTION: 'instruction',
  BIO: 'bio',
  SYNC: 'sync',
} as const;

export type StreamService = (typeof StreamService)[keyof typeof StreamService];
