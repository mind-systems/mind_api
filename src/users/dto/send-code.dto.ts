import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendCodeDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsOptional()
  @IsString()
  locale?: string;
}
