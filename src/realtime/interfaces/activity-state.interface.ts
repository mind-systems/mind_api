import { ActivityType } from '../enums/activity-type.enum';

export interface ActivityState {
  sessionId: string;
  activityType: ActivityType;
  activityRefId?: string;
  rootSessionId?: string | null;
  startedAt: Date;
  lastActivityAt: Date;
  isPaused: boolean;
}
