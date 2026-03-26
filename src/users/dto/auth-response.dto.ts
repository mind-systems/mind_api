import { UserRole } from '../interfaces/user-role.enum';

export class UserResponseDto {
  id: string;

  email: string;

  name: string;

  role: UserRole;

  language: string;

  constructor(user: any) {
    this.id = user.id;
    this.email = user.email;
    this.name = user.name;
    this.role = user.role;
    this.language = user.language;
  }
}

export class AuthResponseDto {
  accessToken: string;

  user: UserResponseDto;

  constructor(accessToken: string, user: UserResponseDto) {
    this.accessToken = accessToken;
    this.user = user;
  }
}
