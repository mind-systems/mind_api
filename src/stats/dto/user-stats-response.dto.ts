export class UserStatsResponseDto {
  totalSessions: number;

  totalDurationSeconds: number;

  currentStreak: number;

  longestStreak: number;

  lastSessionDate: string | null;

  maxCompletedComplexity: number;
}
