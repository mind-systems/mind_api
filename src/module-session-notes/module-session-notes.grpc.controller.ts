import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  CreateNoteRequest,
  UpdateNoteRequest,
  ListNotesRequest,
  ListNotesResponse,
  ModuleSessionNote as ModuleSessionNoteProto,
} from '../../proto/generated/module_session_notes';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { toProtoModuleSessionNote } from '../grpc/grpc-mappers';
import { ModuleSessionNotesService } from './module-session-notes.service';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class ModuleSessionNotesGrpcController {
  constructor(
    private readonly moduleSessionNotesService: ModuleSessionNotesService,
  ) {}

  @GrpcMethod('ModuleSessionNotesService', 'createNote')
  async createNote(
    @Payload() req: CreateNoteRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ModuleSessionNoteProto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const note = await this.moduleSessionNotesService.create(
      user.sub,
      req.sessionId || null,
      req.noteText,
    );
    return toProtoModuleSessionNote(note);
  }

  @GrpcMethod('ModuleSessionNotesService', 'updateNote')
  async updateNote(
    @Payload() req: UpdateNoteRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ModuleSessionNoteProto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const note = await this.moduleSessionNotesService.updateText(
      req.noteId,
      user.sub,
      req.noteText,
    );
    return toProtoModuleSessionNote(note);
  }

  @GrpcMethod('ModuleSessionNotesService', 'listNotes')
  async listNotes(
    @Payload() req: ListNotesRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ListNotesResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const { notes, nextPageToken } = await this.moduleSessionNotesService.list(
      user.sub,
      req.pageSize,
      req.pageToken,
    );
    return { notes: notes.map(toProtoModuleSessionNote), nextPageToken };
  }
}
