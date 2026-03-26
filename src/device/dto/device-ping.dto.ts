import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class DevicePingDto {
  @IsString()
  installationId: string;

  @IsString()
  platform: string;

  @IsString()
  osVersion: string;

  @IsString()
  locale: string;

  @IsString()
  timezone: string;

  @IsInt()
  @Min(0)
  screenWidth: number;

  @IsInt()
  @Min(0)
  screenHeight: number;

  @IsString()
  appVersion: string;

  @IsString()
  buildNumber: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;
}
