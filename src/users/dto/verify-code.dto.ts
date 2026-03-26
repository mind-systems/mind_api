import {
  IsString,
  IsNotEmpty,
  IsEmail,
  Matches,
  IsOptional,
} from 'class-validator';

export class VerifyCodeDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code: string;

  @IsString()
  @IsOptional()
  language?: string;
}
