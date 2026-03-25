import { ApiProperty } from '@nestjs/swagger';

export class UserStatsResponseDto {
  @ApiProperty({ description: 'Total number of qualifying sessions completed' })
  totalSessions: number;

  @ApiProperty({
    description: 'Total duration of all qualifying sessions in seconds',
  })
  totalDurationSeconds: number;

  @ApiProperty({ description: 'Current consecutive-day streak' })
  currentStreak: number;

  @ApiProperty({ description: 'Longest consecutive-day streak ever recorded' })
  longestStreak: number;

  @ApiProperty({
    description: 'Date of the last qualifying session (YYYY-MM-DD), or null',
    nullable: true,
    type: String,
  })
  lastSessionDate: string | null;

  @ApiProperty({
    description: 'Smoothed maximum complexity of completed breath sessions',
  })
  maxCompletedComplexity: number;
}
