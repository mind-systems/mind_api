import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/users/guards/jwt-auth.guard';
import { SyncService } from './sync.service';
import {
  SyncChangesQueryDto,
  SyncChangesResponseDto,
  SyncFullResyncResponseDto,
} from './dto/sync-changes.dto';

@ApiExtraModels(SyncChangesResponseDto, SyncFullResyncResponseDto)
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get change events for sync' })
  @ApiResponse({
    status: 200,
    description: 'Change events or full-resync signal',
    schema: {
      oneOf: [
        { $ref: '#/components/schemas/SyncChangesResponseDto' },
        { $ref: '#/components/schemas/SyncFullResyncResponseDto' },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('changes')
  async getChanges(@Request() req, @Query() query: SyncChangesQueryDto) {
    const userId: string = req.user.sub;
    return this.syncService.getChanges(userId, query.after, query.limit);
  }
}
