import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { ListRunsQueryDto } from './dto/list-runs-query.dto';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('runs')
  listRuns(
    @Query() query: ListRunsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.listRuns(user.sub, query.limit, query.offset);
  }
}
