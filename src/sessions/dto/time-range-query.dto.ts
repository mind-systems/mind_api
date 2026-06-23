import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, Min } from 'class-validator';

export class TimeRangeQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bucketSec?: number;

  @IsOptional()
  @IsIn(['minmax', 'avg', 'lttb'])
  agg?: string;
}
