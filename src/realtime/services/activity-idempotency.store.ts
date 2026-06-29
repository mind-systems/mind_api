/**
 * Controller-owned idempotency map for activity:start dedup.
 *
 * Plain class — NOT @Injectable. Instantiated directly as a controller field
 * so it adds no constructor parameter and stays invisible to DI.
 */
export class ActivityIdempotencyStore {
  private readonly map = new Map<
    string,
    { sessionId: string; storedAt: number }
  >();

  /**
   * Returns the cached sessionId if the entry exists and is still within
   * windowMs. Deletes stale entries on access.
   */
  lookup(key: string, windowMs: number): string | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt < windowMs) {
      return entry.sessionId;
    }
    this.map.delete(key);
    return undefined;
  }

  /** Store a clientActivityId → sessionId mapping with the current timestamp. */
  record(key: string, sessionId: string): void {
    this.map.set(key, { sessionId, storedAt: Date.now() });
  }

  /**
   * Delete every entry whose key starts with `${userId}:`.
   * Called on stream teardown so a reconnecting client is not deduped against
   * a stale token from a previous connection.
   */
  evictUser(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }
}
