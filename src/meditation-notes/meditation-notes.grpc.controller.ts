import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  CreateNoteRequest,
  UpdateNoteRequest,
  ListNotesRequest,
  ListNotesResponse,
  MeditationNote as MeditationNoteProto,
} from '../../proto/generated/meditation_notes';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { toProtoMeditationNote } from '../grpc/grpc-mappers';
import { MeditationNotesService } from './meditation-notes.service';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class MeditationNotesGrpcController {
  constructor(
    private readonly meditationNotesService: MeditationNotesService,
  ) {}

  @GrpcMethod('MeditationNotesService', 'createNote')
  async createNote(
    @Payload() req: CreateNoteRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<MeditationNoteProto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const note = await this.meditationNotesService.create(
      user.sub,
      req.sessionId || null,
      req.poseId,
      req.noteText,
    );
    return toProtoMeditationNote(note);
  }

  @GrpcMethod('MeditationNotesService', 'updateNote')
  async updateNote(
    @Payload() req: UpdateNoteRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<MeditationNoteProto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const note = await this.meditationNotesService.updateText(
      req.noteId,
      user.sub,
      req.noteText,
    );
    return toProtoMeditationNote(note);
  }

  @GrpcMethod('MeditationNotesService', 'listNotes')
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
    const { notes, nextPageToken } = await this.meditationNotesService.list(
      user.sub,
      req.pageSize,
      req.pageToken,
    );
    return { notes: notes.map(toProtoMeditationNote), nextPageToken };
  }
}
