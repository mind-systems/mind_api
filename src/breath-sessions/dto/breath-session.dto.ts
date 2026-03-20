import {
  IsString,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  IsNotEmpty,
  ArrayMaxSize,
  ArrayMinSize,
  IsUUID,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BreathSession } from '../entities/breath-session.entity';
import { TimeOfDay } from '../enums/time-of-day.enum';

class BreathStepDto {
  @ApiProperty({ enum: ['inhale', 'exhale', 'hold'] })
  @IsEnum(['inhale', 'exhale', 'hold'])
  type: 'inhale' | 'exhale' | 'hold';

  @ApiProperty({ example: 4000, description: 'Duration in milliseconds' })
  @IsNumber()
  @Min(0)
  duration: number;
}

class BreathExerciseDto {
  @ApiProperty({ type: [BreathStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathStepDto)
  steps: BreathStepDto[];

  @ApiProperty({ example: 2000 })
  @IsNumber()
  @Min(0)
  restDuration: number;

  @ApiProperty({ example: 3 })
  @IsNumber()
  @Min(1)
  repeatCount: number;
}

export class CreateBreathSessionDto {
  @ApiProperty({ example: 'Morning relaxation' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ type: [BreathExerciseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathExerciseDto)
  exercises: BreathExerciseDto[];

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  shared?: boolean;

  @ApiPropertyOptional({ enum: TimeOfDay })
  @IsEnum(TimeOfDay)
  @IsOptional()
  timeOfDay?: TimeOfDay;
}

export class UpdateBreathSessionDto {
  @ApiPropertyOptional({ example: 'Updated relaxation' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ type: [BreathExerciseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathExerciseDto)
  @IsOptional()
  exercises?: BreathExerciseDto[];

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  shared?: boolean;

  @ApiPropertyOptional({ enum: TimeOfDay })
  @IsEnum(TimeOfDay)
  @IsOptional()
  timeOfDay?: TimeOfDay;
}

export class ReplaceBreathSessionDto {
  @ApiProperty({ example: 'Morning relaxation' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ type: [BreathExerciseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathExerciseDto)
  exercises: BreathExerciseDto[];

  @ApiProperty({ example: false })
  @IsBoolean()
  shared: boolean;

  @ApiPropertyOptional({ enum: TimeOfDay, nullable: true })
  @IsEnum(TimeOfDay)
  @IsOptional()
  timeOfDay?: TimeOfDay | null;
}

export class ListQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number = 20;
}

export class BreathSessionWithStarredDto extends BreathSession {
  @ApiPropertyOptional({
    example: false,
    description:
      'Whether the current user has starred this session (present only when authenticated)',
  })
  isStarred?: boolean;
}

export class BreathSessionListResponseDto {
  @ApiProperty({ type: [BreathSessionWithStarredDto] })
  data: BreathSessionWithStarredDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;
}

export class SuggestionsQueryDto {
  @ApiProperty({ enum: TimeOfDay })
  @IsEnum(TimeOfDay)
  @IsNotEmpty()
  timeOfDay: TimeOfDay;
}

export class BatchQueryDto {
  @ApiProperty({
    description: 'Comma-separated session UUIDs (max 50)',
    example: 'uuid1,uuid2',
  })
  @Transform(({ value }) =>
    String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50, { message: 'Maximum 50 IDs per request' })
  @IsUUID('4', { each: true })
  ids: string[];
}
