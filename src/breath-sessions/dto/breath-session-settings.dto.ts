import { IsBoolean } from 'class-validator';

export class UpdateBreathSessionSettingsDto {
  @IsBoolean()
  starred: boolean;
}

export class BreathSessionSettingsResponseDto {
  starred: boolean;
}
