import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { SUPPORTED_LOCALES } from '../../config/locales';

export class UpdateUserDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsIn(SUPPORTED_LOCALES)
  @IsOptional()
  language?: string;
}
