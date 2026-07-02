export interface InstructionSample extends Record<string, unknown> {
  timestamp: number;
  data: unknown;
  /**
   * Set only by StreamEngine.push()'s server-side callers (never present on
   * client-supplied samples — the gRPC controller never sets this field on
   * the object it builds from the wire), so it is a reliable discriminator
   * for the immediate-persist marker path.
   */
  serverMarker?: true;
}

export interface SessionBuffer {
  sessionId: string;
  samples: InstructionSample[];
  byteSize: number;
  totalReceived: number;
}
