import type { UserDto } from '../../proto/generated/auth';
import type { UserResponseDto } from '../users/dto/auth-response.dto';
import { UserRole } from '../users/interfaces/user-role.enum';

export function toProtoUserRole(role: UserRole): number {
  switch (role) {
    case UserRole.ADMIN:
      return 1;
    case UserRole.USER:
    default:
      return 0;
  }
}

export function toProtoUserDto(dto: UserResponseDto): UserDto {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name,
    role: toProtoUserRole(dto.role),
    language: dto.language,
  };
}
