export class TokenResponseDto {
  id: string;

  name: string;

  createdAt: Date;

  lastUsedAt: Date | null;
}

export class CreateTokenResponseDto {
  token: string;

  id: string;

  name: string;

  createdAt: Date;
}
