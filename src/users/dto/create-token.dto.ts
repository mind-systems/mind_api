import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTokenDto {
  @ApiProperty({ example: 'My CLI token' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
