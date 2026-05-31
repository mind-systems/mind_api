import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class GoogleCodeExchangeDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^https?:\/\//, {
    message: 'redirectUri must be an http(s) URL',
  })
  redirectUri: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  state?: string;
}
