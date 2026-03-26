import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  serverAuthCode: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9+\-.]*:\/\//, {
    message: 'redirectUri must be a valid URI',
  })
  redirectUri?: string;
}
