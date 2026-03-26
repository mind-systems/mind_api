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
import { BreathSession } from '../entities/breath-session.entity';
import { TimeOfDay } from '../enums/time-of-day.enum';

class BreathStepDto {
  @IsEnum(['inhale', 'exhale', 'hold'])
  type: 'inhale' | 'exhale' | 'hold';

  @IsNumber()
  @Min(0)
  duration: number;
}

class BreathExerciseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathStepDto)
  steps: BreathStepDto[];

  @IsNumber()
  @Min(0)
  restDuration: number;

  @IsNumber()
  @Min(1)
  repeatCount: number;
}

export class CreateBreathSessionDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathExerciseDto)
  exercises: BreathExerciseDto[];

  @IsBoolean()
  @IsOptional()
  shared?: boolean;

  @IsEnum(TimeOfDay)
  @IsOptional()
  timeOfDay?: TimeOfDay;
}

export class UpdateBreathSessionDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathExerciseDto)
  @IsOptional()
  exercises?: BreathExerciseDto[];

  @IsBoolean()
  @IsOptional()
  shared?: boolean;

  @IsEnum(TimeOfDay)
  @IsOptional()
  timeOfDay?: TimeOfDay;
}

export class ReplaceBreathSessionDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreathExerciseDto)
  exercises: BreathExerciseDto[];

  @IsBoolean()
  shared: boolean;

  @IsEnum(TimeOfDay)
  @IsOptional()
  timeOfDay?: TimeOfDay | null;
}

export class ListQueryDto {
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number = 20;
}

export class BreathSessionWithStarredDto extends BreathSession {
  isStarred?: boolean;
}

export class BreathSessionListResponseDto {
  data: BreathSessionWithStarredDto[];

  total: number;

  page: number;

  pageSize: number;
}

export class SuggestionsQueryDto {
  @IsEnum(TimeOfDay)
  @IsNotEmpty()
  timeOfDay: TimeOfDay;
}

export class BatchQueryDto {
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
