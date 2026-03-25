import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserSession } from './entities/user-session.entity';
import { AuthCode } from './entities/auth-code.entity';
import { PersonalAccessToken } from './entities/personal-access-token.entity';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthGrpcController } from './auth.grpc.controller';
import { AuthService } from './service/auth.service';
import { SessionService } from './service/session.service';
import { AuthCodeService } from './service/auth-code.service';
import { GoogleTokenService } from './service/google-token.service';
import { PersonalAccessTokenService } from './service/personal-access-token.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserSession,
      AuthCode,
      PersonalAccessToken,
    ]),
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is not defined');
        }

        return { secret };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, AuthGrpcController],
  providers: [
    AuthService,
    AuthCodeService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    SessionService,
    GoogleTokenService,
    PersonalAccessTokenService,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    SessionService,
    JwtModule,
    GoogleTokenService,
    PersonalAccessTokenService,
  ],
})
export class AuthModule {}
