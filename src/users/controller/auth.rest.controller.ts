import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthCodeService } from '../service/auth-code.service';
import { SendCodeDto } from '../dto/send-code.dto';
import { VerifyCodeDto } from '../dto/verify-code.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthRestController {
  constructor(private readonly authCodeService: AuthCodeService) {}

  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async sendCode(@Body() dto: SendCodeDto): Promise<{ message: string }> {
    await this.authCodeService.sendCode(dto.email, dto.locale);
    return { message: 'ok' };
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async verifyCode(@Body() dto: VerifyCodeDto): Promise<AuthResponseDto> {
    return this.authCodeService.verifyCode(dto.email, dto.code, dto.language);
  }
}
