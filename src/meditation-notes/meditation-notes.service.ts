import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { MeditationNote } from './entities/meditation-note.entity';

@Injectable()
export class MeditationNotesService {
  constructor(
    @InjectRepository(MeditationNote)
    private readonly repo: Repository<MeditationNote>,
  ) {}

  async create(
    userId: string,
    sessionId: string | null,
    poseId: string,
    noteText: string,
  ): Promise<MeditationNote> {
    const note = this.repo.create({ userId, sessionId, poseId, noteText });
    try {
      return await this.repo.save(note);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const code = (err as QueryFailedError & { code?: string }).code;
        if (code === '23505') {
          throw new RpcException({
            code: GrpcStatus.ALREADY_EXISTS,
            message: 'Note for this session already exists',
          });
        }
        if (code === '23503') {
          note.sessionId = null;
          return this.repo.save(note);
        }
      }
      throw err;
    }
  }

  async updateText(
    noteId: string,
    userId: string,
    noteText: string,
  ): Promise<MeditationNote> {
    const note = await this.repo.findOneBy({ id: noteId });
    if (!note) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: 'Note not found',
      });
    }
    if (note.userId !== userId) {
      throw new RpcException({
        code: GrpcStatus.PERMISSION_DENIED,
        message: 'Note belongs to another user',
      });
    }
    note.noteText = noteText;
    return this.repo.save(note);
  }

  async list(
    userId: string,
    pageSize: number,
    pageToken: string,
  ): Promise<{ notes: MeditationNote[]; nextPageToken: string }> {
    const limit = Math.min(pageSize || 20, 100);
    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .take(limit + 1);

    if (pageToken) {
      const cursor = Buffer.from(pageToken, 'base64url').toString('utf8');
      qb.andWhere('n.createdAt < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextPageToken = hasMore
      ? Buffer.from(items[items.length - 1].createdAt.toISOString()).toString(
          'base64url',
        )
      : '';

    return { notes: items, nextPageToken };
  }
}
