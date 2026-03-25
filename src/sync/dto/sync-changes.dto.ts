import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SyncChangesQueryDto {
  @ApiProperty({
    description: 'Return events with id > after. Use 0 for initial sync.',
    type: Number,
  })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  after: number;

  @ApiPropertyOptional({
    description: 'Maximum number of events to return (max 100)',
    type: Number,
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit: number = 100;
}

export class SyncEventDto {
  @ApiProperty({ type: Number })
  id: number;

  @ApiProperty()
  entity: string;

  @ApiProperty()
  refId: string;

  @ApiProperty()
  action: string;

  @ApiProperty()
  createdAt: Date;
}

export class SyncChangesResponseDto {
  @ApiProperty({ type: [SyncEventDto] })
  events: SyncEventDto[];

  @ApiProperty({
    type: Number,
    description: 'Cursor to use in the next request',
  })
  cursor: number;

  @ApiProperty({
    type: Boolean,
    description: 'Whether there are more events available',
  })
  hasMore: boolean;
}

export class SyncFullResyncResponseDto {
  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'Signals the client to perform a full resync',
  })
  fullResync: boolean;
}
