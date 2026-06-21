import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ActivityType } from '../enums/activity-type.enum';

export class ActivityStartDto {
  @IsEnum(ActivityType)
  activityType: ActivityType;

  @IsString()
  @IsOptional()
  activityRefId?: string;

  @IsNumber()
  @IsOptional()
  clientTimestampMs?: number;
}
