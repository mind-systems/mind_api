import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User } from '../entities/user.entity';
import { JwtPayload, RequestWithUser } from '../interfaces/auth.interface';
import { AuthResponseDto, UserResponseDto } from '../dto/auth-response.dto';
import { SessionService } from './session.service';
import { GoogleTokenService } from './google-token.service';
import { UserRole } from '../interfaces/user-role.enum';
import { resolveLocale } from '../../config/locales';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    private readonly googleTokenService: GoogleTokenService,
    private readonly dataSource: DataSource,
  ) {}

  async logout(req: RequestWithUser): Promise<void> {
    const authHeader = req.headers?.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;
    if (!token) return;

    await this.sessionService.revoke(token);
    this.logger.log(`User logged out, session revoked.`);
  }

  async generateToken(user: User): Promise<AuthResponseDto> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
    };

    const accessToken = this.jwtService.sign(payload);
    await this.sessionService.create(accessToken, user.id);
    const userDto = new UserResponseDto(user);

    return new AuthResponseDto(accessToken, userDto);
  }

  async signInWithGoogle(
    serverAuthCode: string,
    language?: string,
    redirectUri?: string,
  ): Promise<AuthResponseDto> {
    this.logger.log(
      'signInWithGoogle: exchanging server auth code for Google profile',
    );
    const profile = await this.googleTokenService.exchangeCodeForProfile(
      serverAuthCode,
      redirectUri,
    );
    this.logger.log(`signInWithGoogle: looking up or creating user`);

    const user = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);

      const existing = await userRepo
        .createQueryBuilder('u')
        .setLock('pessimistic_write')
        .where('u.email = :email', { email: profile.email })
        .getOne();

      if (existing) {
        this.logger.log(
          `signInWithGoogle: existing user found, userId=${existing.id}`,
        );
        return existing;
      }

      const resolvedLanguage = resolveLocale(language);
      const created = userRepo.create({
        email: profile.email,
        name: profile.name,
        role: UserRole.USER,
        language: resolvedLanguage,
      });
      const saved = await userRepo.save(created);
      this.logger.log(
        `signInWithGoogle: new user registered, userId=${saved.id}, language=${resolvedLanguage}`,
      );
      return saved;
    });

    return await this.generateToken(user);
  }

  async validateUser(userId: string): Promise<User | null> {
    try {
      return await this.userRepository.findOne({ where: { id: userId } });
    } catch {
      return null;
    }
  }
}
