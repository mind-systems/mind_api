import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { ModuleSession } from '../realtime/entities/module-session.entity';
import { ActivityType } from '../realtime/enums/activity-type.enum';
import { SessionStatus } from '../realtime/enums/session-status.enum';

const makeSession = (overrides: Partial<ModuleSession> = {}): ModuleSession =>
  Object.assign(new ModuleSession(), {
    id: 'session-uuid',
    userId: 'user-uuid',
    activityType: ActivityType.BREATH,
    status: SessionStatus.COMPLETED,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  });

describe('SessionsService.deleteRun', () => {
  let service: SessionsService;
  let moduleSessionRepo: jest.Mocked<any>;
  let bioSampleRepo: jest.Mocked<any>;
  let streamSampleRepo: jest.Mocked<any>;

  beforeEach(() => {
    moduleSessionRepo = {
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    // bio/stream repos have delete mocks so we can assert they are never called by the service
    // (cascade is DB-level, not service-level)
    bioSampleRepo = { delete: jest.fn() };
    streamSampleRepo = { delete: jest.fn() };

    service = new SessionsService(
      moduleSessionRepo,
      bioSampleRepo,
      streamSampleRepo,
    );
  });

  describe('owned session → delete + cascade', () => {
    it('calls delete with the session id and resolves', async () => {
      const session = makeSession({ id: 'session-uuid', userId: 'user-uuid' });
      moduleSessionRepo.findOne.mockResolvedValue(session);
      moduleSessionRepo.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.deleteRun('user-uuid', 'session-uuid'),
      ).resolves.toBeUndefined();

      expect(moduleSessionRepo.delete).toHaveBeenCalledWith({
        id: 'session-uuid',
      });
    });

    it('does NOT call delete on bio or stream repos (cascade is DB-level)', async () => {
      // user_stats is also never referenced — stats are untouched by design
      const session = makeSession({ id: 'session-uuid', userId: 'user-uuid' });
      moduleSessionRepo.findOne.mockResolvedValue(session);
      moduleSessionRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteRun('user-uuid', 'session-uuid');

      expect(bioSampleRepo.delete).not.toHaveBeenCalled();
      expect(streamSampleRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('foreign session → 403', () => {
    it('throws ForbiddenException and never calls delete', async () => {
      const session = makeSession({
        id: 'session-uuid',
        userId: 'other-user-uuid',
      });
      moduleSessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.deleteRun('user-uuid', 'session-uuid'),
      ).rejects.toThrow(ForbiddenException);

      expect(moduleSessionRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('missing session → 404', () => {
    it('throws NotFoundException and never calls delete', async () => {
      moduleSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteRun('user-uuid', 'nonexistent-uuid'),
      ).rejects.toThrow(NotFoundException);

      expect(moduleSessionRepo.delete).not.toHaveBeenCalled();
    });
  });
});
