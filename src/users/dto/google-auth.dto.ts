import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({
    description: 'Server authorization code from Google Sign-In SDK',
  })
  @IsString()
  @IsNotEmpty()
  serverAuthCode: string;

  @ApiPropertyOptional({
    example: 'ru',
    description: 'Raw device locale (used only on first registration)',
  })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({
    description:
      'OAuth redirect URI used in browser-based flow (required for code exchange)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9+\-.]*:\/\//, {
    message: 'redirectUri must be a valid URI',
  })
  redirectUri?: string;
}
