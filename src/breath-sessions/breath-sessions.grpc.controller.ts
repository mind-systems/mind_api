import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  BatchGetSessionsRequest,
  BatchGetSessionsResponse,
  BreathSessionDto,
  BreathSessionServiceController,
  BreathSessionServiceControllerMethods,
  BreathSessionWithStarredDto,
  CreateSessionRequest,
  DeleteSessionRequest,
  DeleteSessionResponse,
  GetSessionRequest,
  GetSuggestionsRequest,
  GetSuggestionsResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ReplaceSessionRequest,
  UpdateSessionRequest,
  UpdateSessionSettingsRequest,
  UpdateSessionSettingsResponse,
} from '../../proto/generated/breath_sessions';
import { BreathSessionsService } from './breath-sessions.service';
import { BreathSessionSettingsService } from './breath-session-settings.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import {
  fromProtoExercises,
  fromProtoTimeOfDay,
  toProtoBreathSessionDto,
  toProtoBreathSessionWithStarredDto,
} from '../grpc/grpc-mappers';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import {
  GrpcCurrentUser,
  GrpcOptionalAuth,
} from '../grpc/decorators';

@Controller()
@BreathSessionServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class BreathSessionsGrpcController
  implements BreathSessionServiceController
{
  constructor(
    private readonly breathSessionsService: BreathSessionsService,
    private readonly breathSessionSettingsService: BreathSessionSettingsService,
  ) {}

  async createSession(
    @Payload() request: CreateSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const session = await this.breathSessionsService.create(user.sub, {
      description: request.description,
      exercises: fromProtoExercises(request.exercises),
      shared: request.shared,
      timeOfDay:
        request.timeOfDay !== undefined
          ? fromProtoTimeOfDay(request.timeOfDay)
          : undefined,
    });
    return toProtoBreathSessionDto(session);
  }

  @GrpcOptionalAuth()
  async listSessions(
    @Payload() request: ListSessionsRequest,
    @GrpcCurrentUser() user?: JwtPayload | null,
  ): Promise<ListSessionsResponse> {
    const result = await this.breathSessionsService.findList(
      user?.sub ?? null,
      request.page,
      request.pageSize,
    );
    return {
      data: result.data.map(toProtoBreathSessionWithStarredDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async getSuggestions(
    @Payload() request: GetSuggestionsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<GetSuggestionsResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const timeOfDay = fromProtoTimeOfDay(request.timeOfDay);
    const sessions = await this.breathSessionsService.findSuggestions(
      user.sub,
      timeOfDay,
    );
    return { suggestions: sessions.map(toProtoBreathSessionDto) };
  }

  @GrpcOptionalAuth()
  async batchGetSessions(
    @Payload() request: BatchGetSessionsRequest,
    @GrpcCurrentUser() user?: JwtPayload | null,
  ): Promise<BatchGetSessionsResponse> {
    if (request.ids.length < 1 || request.ids.length > 50) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'ids must contain between 1 and 50 items',
      });
    }
    const sessions = await this.breathSessionsService.findBatch(
      request.ids,
      user?.sub ?? null,
    );
    return { sessions: sessions.map(toProtoBreathSessionWithStarredDto) };
  }

  @GrpcOptionalAuth()
  async getSession(
    @Payload() request: GetSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload | null,
  ): Promise<BreathSessionWithStarredDto> {
    const session = await this.breathSessionsService.findOne(
      request.id,
      user?.sub ?? null,
    );
    return toProtoBreathSessionWithStarredDto(session);
  }

  async updateSession(
    @Payload() request: UpdateSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const dto: {
      description?: string;
      exercises?: ReturnType<typeof fromProtoExercises>;
      shared?: boolean;
      timeOfDay?: ReturnType<typeof fromProtoTimeOfDay>;
    } = {};
    if (request.description !== undefined) {
      dto.description = request.description;
    }
    if (request.exercises !== undefined) {
      dto.exercises = fromProtoExercises(request.exercises.exercises);
    }
    if (request.shared !== undefined) {
      dto.shared = request.shared;
    }
    if (request.timeOfDay !== undefined) {
      dto.timeOfDay = fromProtoTimeOfDay(request.timeOfDay);
    }
    const session = await this.breathSessionsService.update(
      request.id,
      user.sub,
      dto,
    );
    return toProtoBreathSessionDto(session);
  }

  async replaceSession(
    @Payload() request: ReplaceSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<BreathSessionDto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const session = await this.breathSessionsService.replace(
      request.id,
      user.sub,
      {
        description: request.description,
        exercises: fromProtoExercises(request.exercises),
        shared: request.shared,
        timeOfDay:
          request.timeOfDay !== undefined
            ? fromProtoTimeOfDay(request.timeOfDay)
            : undefined,
      },
    );
    return toProtoBreathSessionDto(session);
  }

  async updateSessionSettings(
    @Payload() request: UpdateSessionSettingsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<UpdateSessionSettingsResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    await this.breathSessionsService.findOne(request.id);
    const result = await this.breathSessionSettingsService.upsert(
      user.sub,
      request.id,
      { starred: request.starred },
    );
    return { starred: result.starred };
  }

  async deleteSession(
    @Payload() request: DeleteSessionRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<DeleteSessionResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    await this.breathSessionsService.remove(request.id, user.sub);
    return { message: 'Breath session deleted successfully' };
  }
}
