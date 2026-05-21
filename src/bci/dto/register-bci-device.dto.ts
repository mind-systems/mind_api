import { IsNotEmpty, IsString } from 'class-validator';

export class RegisterBciDeviceDto {
  @IsString()
  @IsNotEmpty()
  serial: string;
}
