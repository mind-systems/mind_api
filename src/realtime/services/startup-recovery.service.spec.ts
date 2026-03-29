import { StartupRecoveryService } from './startup-recovery.service';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityType } from '../enums/activity-type.enum';
import { ModuleSession } from '../entities/module-session.entity';

function makeSession(status: SessionStatus): ModuleSession {
  const now = new Date();
  return {
    id: `session-${Math.random()}`,
    userId: 'user-1',
    activityType: ActivityType.BREATH,
    status,
    startedAt: now,
    lastActivityAt: now,
    createdAt: now,
  } as ModuleSession;
}

describe('StartupRecoveryService', () => {
  let service: StartupRecoveryService;
  let repo: { find: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    repo = { find: jest.fn(), save: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    service = new StartupRecoveryService(repo as any);
  });

  it('abandons orphan sessions on bootstrap', async () => {
    const orphans = [
      makeSession(SessionStatus.ACTIVE),
      makeSession(SessionStatus.DISCONNECTED),
    ];
    repo.find.mockResolvedValue(orphans);
    repo.save.mockResolvedValue(orphans);

    await service.onApplicationBootstrap();

    expect(repo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          status: SessionStatus.ABANDONED,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          endedAt: expect.any(Date),
        }),
        expect.objectContaining({
          status: SessionStatus.ABANDONED,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          endedAt: expect.any(Date),
        }),
      ]),
    );
  });

  it('does not call repo.save when no orphan sessions found', async () => {
    repo.find.mockResolvedValue([]);

    await service.onApplicationBootstrap();

    expect(repo.save).not.toHaveBeenCalled();
  });
});
