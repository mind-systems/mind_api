import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { MeditationNotesService } from './meditation-notes.service';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class MeditationNotesGrpcController {
  constructor(
    private readonly meditationNotesService: MeditationNotesService,
  ) {}
}
