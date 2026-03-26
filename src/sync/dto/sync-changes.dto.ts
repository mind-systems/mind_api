import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SyncChangesQueryDto {
  @IsInt()
  @Min(0)
  @Type(() => Number)
  after: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit: number = 100;
}

export class SyncEventDto {
  id: number;

  entity: string;

  refId: string;

  action: string;

  createdAt: Date;
}

export class SyncChangesResponseDto {
  events: SyncEventDto[];

  cursor: number;

  hasMore: boolean;
}

export class SyncFullResyncResponseDto {
  fullResync: boolean;
}
