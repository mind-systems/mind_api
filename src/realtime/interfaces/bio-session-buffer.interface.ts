/** A single biometric sample received from the mobile client. */
export interface BioSampleInternal {
  /** Client unix-ms at sample production time (not batch-send time). */
  timestamp: number;
  /** Free-string discriminator (`"cardio"`, `"emotions"`, `"nfb"`, …); non-empty enforced at the controller layer. */
  sampleType: string;
  /** Opaque jsonb-shaped payload; schema ownership stays with the producer (mobile). */
  data: unknown;
}

/** In-memory buffer for biometric samples belonging to a single session. */
export interface BioSessionBuffer {
  sessionId: string;
  samples: BioSampleInternal[];
  /** In-memory byte budget used by per-sample partial-accept accounting in `BiometricStreamEngine`. */
  byteSize: number;
  /** Cumulative samples received since session start; not cleared on flush. */
  totalReceived: number;
  /** Cumulative samples dropped since session start; not cleared on flush. */
  totalDropped: number;
}
