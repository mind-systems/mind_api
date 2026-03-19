import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  lastUsedAt: Date | null;
}

export class CreateTokenResponseDto {
  @ApiProperty({ description: 'Raw token — shown only once' })
  token: string;

  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  createdAt: Date;
}
