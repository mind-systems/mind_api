import { Controller, UseFilters } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { JwtService } from '@nestjs/jwt';
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
import { SessionService } from '../users/service/session.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import {
  fromProtoExercises,
  fromProtoTimeOfDay,
  toProtoBreathSessionDto,
  toProtoBreathSessionWithStarredDto,
} from '../grpc/grpc-mappers';
import type { JwtPayload } from '../users/interfaces/auth.interface';
// TODO: uncomment when 1.4 is merged
// import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
// import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@BreathSessionServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
export class BreathSessionsGrpcController
  implements BreathSessionServiceController
{
  constructor(
    private readonly breathSessionsService: BreathSessionsService,
    private readonly breathSessionSettingsService: BreathSessionSettingsService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  private async extractUser(metadata?: Metadata): Promise<JwtPayload> {
    const raw = metadata?.get('authorization')[0]?.toString();
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing authorization metadata',
      });
    }
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Invalid authorization token',
      });
    }
    const isValid = await this.sessionService.isValid(token);
    if (!isValid) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Session not found or revoked',
      });
    }
    return payload;
  }

  private async extractOptionalUser(
    metadata?: Metadata,
  ): Promise<JwtPayload | null> {
    const raw = metadata?.get('authorization')[0]?.toString();
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) {
      return null;
    }
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Invalid authorization token',
      });
    }
    const isValid = await this.sessionService.isValid(token);
    if (!isValid) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Session not found or revoked',
      });
    }
    return payload;
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async createSession(
    request: CreateSessionRequest,
    metadata?: Metadata,
  ): Promise<BreathSessionDto> {
    const user = await this.extractUser(metadata);
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

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async listSessions(
    request: ListSessionsRequest,
    metadata?: Metadata,
  ): Promise<ListSessionsResponse> {
    const user = await this.extractOptionalUser(metadata);
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

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async getSuggestions(
    request: GetSuggestionsRequest,
    metadata?: Metadata,
  ): Promise<GetSuggestionsResponse> {
    const user = await this.extractUser(metadata);
    const timeOfDay = fromProtoTimeOfDay(request.timeOfDay);
    const sessions = await this.breathSessionsService.findSuggestions(
      user.sub,
      timeOfDay,
    );
    return { suggestions: sessions.map(toProtoBreathSessionDto) };
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async batchGetSessions(
    request: BatchGetSessionsRequest,
    metadata?: Metadata,
  ): Promise<BatchGetSessionsResponse> {
    if (request.ids.length < 1 || request.ids.length > 50) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'ids must contain between 1 and 50 items',
      });
    }
    const user = await this.extractOptionalUser(metadata);
    const sessions = await this.breathSessionsService.findBatch(
      request.ids,
      user?.sub ?? null,
    );
    return { sessions: sessions.map(toProtoBreathSessionWithStarredDto) };
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async getSession(
    request: GetSessionRequest,
    metadata?: Metadata,
  ): Promise<BreathSessionWithStarredDto> {
    const user = await this.extractOptionalUser(metadata);
    const session = await this.breathSessionsService.findOne(
      request.id,
      user?.sub ?? null,
    );
    return toProtoBreathSessionWithStarredDto(session);
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async updateSession(
    request: UpdateSessionRequest,
    metadata?: Metadata,
  ): Promise<BreathSessionDto> {
    const user = await this.extractUser(metadata);
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

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async replaceSession(
    request: ReplaceSessionRequest,
    metadata?: Metadata,
  ): Promise<BreathSessionDto> {
    const user = await this.extractUser(metadata);
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

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async updateSessionSettings(
    request: UpdateSessionSettingsRequest,
    metadata?: Metadata,
  ): Promise<UpdateSessionSettingsResponse> {
    const user = await this.extractUser(metadata);
    await this.breathSessionsService.findOne(request.id);
    const result = await this.breathSessionSettingsService.upsert(
      user.sub,
      request.id,
      { starred: request.starred },
    );
    return { starred: result.starred };
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async deleteSession(
    request: DeleteSessionRequest,
    metadata?: Metadata,
  ): Promise<DeleteSessionResponse> {
    const user = await this.extractUser(metadata);
    await this.breathSessionsService.remove(request.id, user.sub);
    return { message: 'Breath session deleted successfully' };
  }
}
