import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityState } from '../interfaces/activity-state.interface';

const DEFAULT_GRACE_MS = 30_000;

interface UserSessions {
  rootSessionId: string | null;
  root?: ActivityState;
  children: Map<string, ActivityState>;
}

@Injectable()
export class ActivitySessionStore {
  private readonly activityMap = new Map<string, UserSessions>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly graceMs: number;

  constructor(private readonly configService: ConfigService) {
    this.graceMs =
      this.configService.get<number>('WS_RECONNECT_GRACE_MS') ??
      DEFAULT_GRACE_MS;
  }

  // ── Legacy sole-child shims (children-only, GAP-03-A) ────────────────────
  // These preserve backward-compatible single-session semantics used by specs
  // and callers that haven't yet migrated to the multi-session API.

  get(userId: string): ActivityState | undefined {
    return this.getSoleChild(userId);
  }

  has(userId: string): boolean {
    const bucket = this.activityMap.get(userId);
    return (bucket?.children.size ?? 0) > 0;
  }

  set(userId: string, state: ActivityState): void {
    let bucket = this.activityMap.get(userId);
    if (!bucket) {
      bucket = { rootSessionId: null, children: new Map() };
      this.activityMap.set(userId, bucket);
    }
    // Reset children to a single entry keyed by state.sessionId.
    // Does not touch the root slot.
    bucket.children.clear();
    bucket.children.set(state.sessionId, state);
  }

  delete(userId: string): boolean {
    const bucket = this.activityMap.get(userId);
    if (!bucket || bucket.children.size === 0) return false;
    const firstKey = bucket.children.keys().next().value as string;
    bucket.children.delete(firstKey);
    this.pruneIfEmpty(userId, bucket);
    return true;
  }

  get size(): number {
    return this.activityMap.size;
  }

  // ── Multi-session methods ────────────────────────────────────────────────

  setRoot(userId: string, sessionId: string, state?: ActivityState): void {
    let bucket = this.activityMap.get(userId);
    if (!bucket) {
      bucket = { rootSessionId: null, children: new Map() };
      this.activityMap.set(userId, bucket);
    }
    bucket.rootSessionId = sessionId;
    bucket.root = state;
  }

  getRoot(userId: string): ActivityState | undefined {
    return this.activityMap.get(userId)?.root;
  }

  getRootId(userId: string): string | null {
    return this.activityMap.get(userId)?.rootSessionId ?? null;
  }

  removeRoot(userId: string): boolean {
    const bucket = this.activityMap.get(userId);
    if (!bucket || bucket.rootSessionId === null) return false;
    bucket.rootSessionId = null;
    bucket.root = undefined;
    this.pruneIfEmpty(userId, bucket);
    return true;
  }

  addChild(userId: string, sessionId: string, state: ActivityState): void {
    let bucket = this.activityMap.get(userId);
    if (!bucket) {
      bucket = { rootSessionId: null, children: new Map() };
      this.activityMap.set(userId, bucket);
    }
    bucket.children.set(sessionId, state);
  }

  getChild(userId: string, sessionId: string): ActivityState | undefined {
    return this.activityMap.get(userId)?.children.get(sessionId);
  }

  /** Child-or-root lookup: resolves a session regardless of whether it is
   *  a child or the root slot. Used by engine paths that accept an explicit
   *  sessionId (e.g. resume, abandon). */
  getSession(userId: string, sessionId: string): ActivityState | undefined {
    return (
      this.getChild(userId, sessionId) ??
      (this.getRootId(userId) === sessionId ? this.getRoot(userId) : undefined)
    );
  }

  /** Returns all children (excludes root). */
  listChildren(userId: string): ActivityState[] {
    const bucket = this.activityMap.get(userId);
    if (!bucket) return [];
    return [...bucket.children.values()];
  }

  removeChild(userId: string, sessionId: string): boolean {
    const bucket = this.activityMap.get(userId);
    if (!bucket) return false;
    const deleted = bucket.children.delete(sessionId);
    if (deleted) this.pruneIfEmpty(userId, bucket);
    return deleted;
  }

  /** Returns the single live child, or undefined if there are zero or more
   *  than one children (root is excluded). */
  getSoleChild(userId: string): ActivityState | undefined {
    const bucket = this.activityMap.get(userId);
    if (!bucket || bucket.children.size !== 1) return undefined;
    return bucket.children.values().next().value as ActivityState;
  }

  // ── Grace timers — sessionId-keyed (engine callers, multi-session) ────────

  startGraceTimerForSession(
    sessionId: string,
    onExpiry: () => void | Promise<void>,
  ): void {
    this.cancelGraceTimerForSession(sessionId);
    const handle = setTimeout(() => {
      this.timers.delete(sessionId);
      void onExpiry();
    }, this.graceMs);
    this.timers.set(sessionId, handle);
  }

  cancelGraceTimerForSession(sessionId: string): void {
    const handle = this.timers.get(sessionId);
    if (handle === undefined) return;
    clearTimeout(handle);
    this.timers.delete(sessionId);
  }

  hasPendingGraceTimerForSession(sessionId: string): boolean {
    return this.timers.has(sessionId);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private pruneIfEmpty(userId: string, bucket: UserSessions): void {
    if (bucket.rootSessionId === null && bucket.children.size === 0) {
      this.activityMap.delete(userId);
    }
  }
}
