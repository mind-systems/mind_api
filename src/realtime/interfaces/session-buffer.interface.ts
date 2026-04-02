export interface InstructionSample extends Record<string, unknown> {
  timestamp: number;
  data: unknown;
}

export interface SessionBuffer {
  sessionId: string;
  samples: InstructionSample[];
  byteSize: number;
  totalReceived: number;
}
