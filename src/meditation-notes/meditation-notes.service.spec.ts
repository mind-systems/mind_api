import { QueryFailedError } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { MeditationNotesService } from './meditation-notes.service';
import { MeditationNote } from './entities/meditation-note.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RepoMock = {
  create: jest.Mock;
  save: jest.Mock;
  findOneBy: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function makeRepo(): RepoMock {
  return {
    create: jest.fn((dto) => ({ ...dto })),
    save: jest.fn(),
    findOneBy: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function makeQb(rows: MeditationNote[]) {
  const stub: Record<string, jest.Mock> = {};
  const chainFns = ['where', 'andWhere', 'orderBy', 'take'];
  chainFns.forEach((fn) => {
    stub[fn] = jest.fn(() => stub);
  });
  stub['getMany'] = jest.fn().mockResolvedValue(rows);
  return stub;
}

function makeNote(overrides: Partial<MeditationNote> = {}): MeditationNote {
  return {
    id: 'note-id-1',
    userId: 'user-id-1',
    sessionId: 'session-id-1',
    poseId: 'pose-id-1',
    noteText: 'hello',
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T10:00:00.000Z'),
    ...overrides,
  };
}

function makeQueryFailedError(code: string): QueryFailedError & { code: string } {
  const err = new QueryFailedError('SELECT', [], new Error('pg error')) as QueryFailedError & { code: string };
  err.code = code;
  return err;
}

function getRpcError(err: unknown): { code: number; message: string } {
  expect(err).toBeInstanceOf(RpcException);
  return (err as RpcException).getError() as { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MeditationNotesService', () => {
  let service: MeditationNotesService;
  let repo: RepoMock;

  beforeEach(() => {
    repo = makeRepo();
    service = new MeditationNotesService(repo as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Phase 1: create()
  // =========================================================================

  describe('create() — happy path', () => {
    it('should build the entity with the given userId, sessionId, poseId and noteText via repo.create', async () => {
      const saved = makeNote();
      repo.save.mockResolvedValue(saved);

      await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');

      expect(repo.create).toHaveBeenCalledWith({
        userId: 'user-id-1',
        sessionId: 'session-id-1',
        poseId: 'pose-id-1',
        noteText: 'hello',
      });
    });

    it('should persist via repo.save and return the saved note when save succeeds', async () => {
      const saved = makeNote();
      repo.save.mockResolvedValue(saved);

      const result = await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result).toBe(saved);
    });

    it('should accept a null sessionId and pass it through to repo.create unchanged', async () => {
      const saved = makeNote({ sessionId: null });
      repo.save.mockResolvedValue(saved);

      await service.create('user-id-1', null, 'pose-id-1', 'hello');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: null }),
      );
    });
  });

  describe('create() — unique constraint (23505)', () => {
    it('should throw RpcException with code ALREADY_EXISTS when save rejects with QueryFailedError code 23505', async () => {
      repo.save.mockRejectedValue(makeQueryFailedError('23505'));

      await expect(
        service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello'),
      ).rejects.toBeInstanceOf(RpcException);

      try {
        await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');
      } catch (err) {
        const rpc = getRpcError(err);
        expect(rpc.code).toBe(GrpcStatus.ALREADY_EXISTS);
      }
    });

    it('should set the ALREADY_EXISTS message to "Note for this session already exists"', async () => {
      repo.save.mockRejectedValue(makeQueryFailedError('23505'));

      try {
        await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');
      } catch (err) {
        const rpc = getRpcError(err);
        expect(rpc.message).toBe('Note for this session already exists');
      }
    });

    it('should not retry save when the unique-constraint branch is taken', async () => {
      repo.save.mockRejectedValue(makeQueryFailedError('23505'));

      try {
        await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');
      } catch {
        // expected
      }

      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('create() — FK violation (23503)', () => {
    it('should null out sessionId and retry save when the first save rejects with QueryFailedError code 23503', async () => {
      const savedNote = makeNote({ sessionId: null });
      repo.save
        .mockRejectedValueOnce(makeQueryFailedError('23503'))
        .mockResolvedValueOnce(savedNote);

      await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');

      // The second call should receive the note with sessionId nulled out
      const secondCallArg = repo.save.mock.calls[1][0];
      expect(secondCallArg.sessionId).toBeNull();
    });

    it('should return the note from the second save when the FK-retry succeeds', async () => {
      const savedNote = makeNote({ sessionId: null });
      repo.save
        .mockRejectedValueOnce(makeQueryFailedError('23503'))
        .mockResolvedValueOnce(savedNote);

      const result = await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');

      expect(result).toBe(savedNote);
    });

    it('should call repo.save twice when the FK-violation branch is taken', async () => {
      const savedNote = makeNote({ sessionId: null });
      repo.save
        .mockRejectedValueOnce(makeQueryFailedError('23503'))
        .mockResolvedValueOnce(savedNote);

      await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');

      expect(repo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('create() — error pass-through', () => {
    it('should re-throw the original error when save rejects with a QueryFailedError whose code is neither 23505 nor 23503', async () => {
      const err = makeQueryFailedError('23502');
      repo.save.mockRejectedValue(err);

      await expect(
        service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello'),
      ).rejects.toBe(err);
    });

    it('should re-throw the original error when save rejects with an error that is not a QueryFailedError', async () => {
      const plainErr = Object.assign(new Error('boom'), { code: '23505' });
      repo.save.mockRejectedValue(plainErr);

      await expect(
        service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello'),
      ).rejects.toBe(plainErr);
    });

    it('should not retry save when a non-handled error is thrown', async () => {
      repo.save.mockRejectedValue(new Error('network'));

      try {
        await service.create('user-id-1', 'session-id-1', 'pose-id-1', 'hello');
      } catch {
        // expected
      }

      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Phase 2: updateText()
  // =========================================================================

  describe('updateText() — not found', () => {
    it('should look up the note via repo.findOneBy with the given noteId', async () => {
      repo.findOneBy.mockResolvedValue(null);

      try {
        await service.updateText('note-id-1', 'user-id-1', 'new text');
      } catch {
        // expected
      }

      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'note-id-1' });
    });

    it('should throw RpcException with code NOT_FOUND when findOneBy returns null', async () => {
      repo.findOneBy.mockResolvedValue(null);

      try {
        await service.updateText('note-id-1', 'user-id-1', 'new text');
        fail('should have thrown');
      } catch (err) {
        const rpc = getRpcError(err);
        expect(rpc.code).toBe(GrpcStatus.NOT_FOUND);
      }
    });

    it('should not call repo.save when the note is not found', async () => {
      repo.findOneBy.mockResolvedValue(null);

      try {
        await service.updateText('note-id-1', 'user-id-1', 'new text');
      } catch {
        // expected
      }

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateText() — ownership check', () => {
    it('should throw RpcException with code PERMISSION_DENIED when the note userId differs from the requesting userId', async () => {
      repo.findOneBy.mockResolvedValue(makeNote({ userId: 'owner-id' }));

      try {
        await service.updateText('note-id-1', 'other-user-id', 'new text');
        fail('should have thrown');
      } catch (err) {
        const rpc = getRpcError(err);
        expect(rpc.code).toBe(GrpcStatus.PERMISSION_DENIED);
      }
    });

    it('should set the PERMISSION_DENIED message to "Note belongs to another user"', async () => {
      repo.findOneBy.mockResolvedValue(makeNote({ userId: 'owner-id' }));

      try {
        await service.updateText('note-id-1', 'other-user-id', 'new text');
        fail('should have thrown');
      } catch (err) {
        const rpc = getRpcError(err);
        expect(rpc.message).toBe('Note belongs to another user');
      }
    });

    it('should not call repo.save when the ownership check fails', async () => {
      repo.findOneBy.mockResolvedValue(makeNote({ userId: 'owner-id' }));

      try {
        await service.updateText('note-id-1', 'other-user-id', 'new text');
      } catch {
        // expected
      }

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateText() — happy path', () => {
    it('should assign the new noteText to the note when the requester owns it', async () => {
      const note = makeNote({ userId: 'user-id-1' });
      repo.findOneBy.mockResolvedValue(note);
      repo.save.mockImplementation(async (n) => n);

      await service.updateText('note-id-1', 'user-id-1', 'updated text');

      expect(note.noteText).toBe('updated text');
    });

    it('should persist the updated note via repo.save and return the saved result', async () => {
      const note = makeNote({ userId: 'user-id-1' });
      const savedNote = { ...note, noteText: 'updated text' };
      repo.findOneBy.mockResolvedValue(note);
      repo.save.mockResolvedValue(savedNote);

      const result = await service.updateText('note-id-1', 'user-id-1', 'updated text');

      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ noteText: 'updated text' }));
      expect(result).toBe(savedNote);
    });
  });

  // =========================================================================
  // Phase 3: list()
  // =========================================================================

  describe('list() — query construction', () => {
    it('should filter by userId via where(\'n.userId = :userId\')', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.list('user-id-1', 10, '');

      expect(qb.where).toHaveBeenCalledWith('n.userId = :userId', { userId: 'user-id-1' });
    });

    it('should order by createdAt DESC', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.list('user-id-1', 10, '');

      expect(qb.orderBy).toHaveBeenCalledWith('n.createdAt', 'DESC');
    });

    it('should call take with limit + 1 to detect the presence of a further page', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.list('user-id-1', 10, '');

      expect(qb.take).toHaveBeenCalledWith(11);
    });

    it('should default the limit to 20 when pageSize is 0 or falsy', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.list('user-id-1', 0, '');

      expect(qb.take).toHaveBeenCalledWith(21);
    });

    it('should cap the limit at 100 when pageSize exceeds 100', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.list('user-id-1', 9999, '');

      expect(qb.take).toHaveBeenCalledWith(101);
    });
  });

  describe('list() — cursor decoding', () => {
    it('should not add an andWhere createdAt clause when pageToken is empty', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.list('user-id-1', 10, '');

      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('should decode the base64url pageToken to an ISO timestamp and apply andWhere with that value', async () => {
      const isoString = '2026-01-01T10:00:00.000Z';
      const token = Buffer.from(isoString).toString('base64url');
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.list('user-id-1', 10, token);

      expect(qb.andWhere).toHaveBeenCalledWith('n.createdAt < :cursor', { cursor: isoString });
    });
  });

  describe('list() — hasMore and nextPageToken', () => {
    it('should return all rows and an empty nextPageToken when getMany returns limit or fewer rows', async () => {
      const notes = [makeNote({ id: 'n1' }), makeNote({ id: 'n2' })];
      const qb = makeQb(notes);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list('user-id-1', 10, '');

      expect(result.notes).toHaveLength(2);
      expect(result.nextPageToken).toBe('');
    });

    it('should drop the extra row (slice to limit) when getMany returns more than limit rows', async () => {
      // limit = 2, getMany returns 3 rows (limit + 1)
      const notes = [
        makeNote({ id: 'n1', createdAt: new Date('2026-01-03T00:00:00.000Z') }),
        makeNote({ id: 'n2', createdAt: new Date('2026-01-02T00:00:00.000Z') }),
        makeNote({ id: 'n3', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      ];
      const qb = makeQb(notes);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list('user-id-1', 2, '');

      expect(result.notes).toHaveLength(2);
      expect(result.notes.map((n) => n.id)).toEqual(['n1', 'n2']);
    });

    it('should encode the last returned note\'s createdAt ISO string as a base64url nextPageToken when there are more rows', async () => {
      const lastDate = new Date('2026-01-02T00:00:00.000Z');
      const notes = [
        makeNote({ id: 'n1', createdAt: new Date('2026-01-03T00:00:00.000Z') }),
        makeNote({ id: 'n2', createdAt: lastDate }),
        makeNote({ id: 'n3', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      ];
      const qb = makeQb(notes);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list('user-id-1', 2, '');

      const expectedToken = Buffer.from(lastDate.toISOString()).toString('base64url');
      expect(result.nextPageToken).toBe(expectedToken);
    });

    it('should produce a nextPageToken that round-trips back to the last item\'s createdAt ISO string', async () => {
      const lastDate = new Date('2026-06-15T08:30:00.000Z');
      const notes = [
        makeNote({ id: 'n1', createdAt: new Date('2026-06-16T00:00:00.000Z') }),
        makeNote({ id: 'n2', createdAt: lastDate }),
        makeNote({ id: 'n3', createdAt: new Date('2026-06-14T00:00:00.000Z') }),
      ];
      const qb = makeQb(notes);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list('user-id-1', 2, '');

      const decoded = Buffer.from(result.nextPageToken, 'base64url').toString('utf8');
      expect(decoded).toBe(lastDate.toISOString());
    });

    it('should return an empty notes array and empty nextPageToken when getMany returns no rows', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list('user-id-1', 10, '');

      expect(result.notes).toEqual([]);
      expect(result.nextPageToken).toBe('');
    });
  });
});
