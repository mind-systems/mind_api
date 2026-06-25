import { QueryFailedError } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { BciDeviceService } from './bci-device.service';
import { BciDevice } from './entities/bci-device.entity';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRepo() {
  return {
    find: jest.fn(),
    update: jest.fn(),
    findOneByOrFail: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
}

function makeDevice(overrides: Partial<BciDevice> = {}): BciDevice {
  return Object.assign(new BciDevice(), {
    id: 'device-uuid',
    userId: 'user-uuid',
    serial: 'SN-001',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

// ── listForUser ───────────────────────────────────────────────────────────────

describe('BciDeviceService.listForUser', () => {
  let service: BciDeviceService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new BciDeviceService(repo as any);
  });

  it('should return an empty array when the user has no devices', async () => {
    repo.find.mockResolvedValue([]);

    const result = await service.listForUser('user-uuid');

    expect(result).toEqual([]);
  });

  it('should return devices as returned by the repository (ordered by updatedAt DESC)', async () => {
    const devices = [makeDevice({ id: 'dev-1' }), makeDevice({ id: 'dev-2' })];
    repo.find.mockResolvedValue(devices);

    const result = await service.listForUser('user-uuid');

    expect(result).toBe(devices);
  });

  it('should call find with where { userId } and order { updatedAt: DESC }', async () => {
    repo.find.mockResolvedValue([]);

    await service.listForUser('user-uuid');

    expect(repo.find).toHaveBeenCalledWith({
      where: { userId: 'user-uuid' },
      order: { updatedAt: 'DESC' },
    });
  });

  it('should propagate errors thrown by find', async () => {
    const error = new Error('DB connection lost');
    repo.find.mockRejectedValue(error);

    await expect(service.listForUser('user-uuid')).rejects.toThrow(error);
  });
});

// ── register — fast path ──────────────────────────────────────────────────────

describe('BciDeviceService.register — fast path (existing row)', () => {
  let service: BciDeviceService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new BciDeviceService(repo as any);
  });

  it('should call update with { userId, serial } and an updatedAt function returning CURRENT_TIMESTAMP', async () => {
    repo.update.mockResolvedValue({ affected: 1 });
    repo.findOneByOrFail.mockResolvedValue(makeDevice());

    await service.register('user-uuid', 'SN-001');

    expect(repo.update).toHaveBeenCalledWith(
      { userId: 'user-uuid', serial: 'SN-001' },
      expect.objectContaining({
        updatedAt: expect.any(Function),
      }),
    );

    const [, updatePayload] = repo.update.mock.calls[0];
    expect(updatePayload.updatedAt()).toBe('CURRENT_TIMESTAMP');
  });

  it('should re-fetch via findOneByOrFail and return the bumped row when update affected > 0', async () => {
    const device = makeDevice();
    repo.update.mockResolvedValue({ affected: 1 });
    repo.findOneByOrFail.mockResolvedValue(device);

    const result = await service.register('user-uuid', 'SN-001');

    expect(repo.findOneByOrFail).toHaveBeenCalledWith({
      userId: 'user-uuid',
      serial: 'SN-001',
    });
    expect(result).toBe(device);
  });

  it('should not call create or save when update affected > 0', async () => {
    repo.update.mockResolvedValue({ affected: 1 });
    repo.findOneByOrFail.mockResolvedValue(makeDevice());

    await service.register('user-uuid', 'SN-001');

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });
});

// ── register — insert path ────────────────────────────────────────────────────

describe('BciDeviceService.register — insert path (new row)', () => {
  let service: BciDeviceService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new BciDeviceService(repo as any);
  });

  it('should proceed to insert when update returns affected 0', async () => {
    const device = makeDevice();
    repo.update.mockResolvedValue({ affected: 0 });
    repo.create.mockReturnValue(device);
    repo.save.mockResolvedValue(device);

    await service.register('user-uuid', 'SN-001');

    expect(repo.create).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  it('should proceed to insert when update returns affected undefined', async () => {
    const device = makeDevice();
    repo.update.mockResolvedValue({ affected: undefined });
    repo.create.mockReturnValue(device);
    repo.save.mockResolvedValue(device);

    await service.register('user-uuid', 'SN-001');

    expect(repo.create).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  it('should call create with { userId, serial } and save the created entity', async () => {
    const device = makeDevice();
    repo.update.mockResolvedValue({ affected: 0 });
    repo.create.mockReturnValue(device);
    repo.save.mockResolvedValue(device);

    await service.register('user-uuid', 'SN-001');

    expect(repo.create).toHaveBeenCalledWith({
      userId: 'user-uuid',
      serial: 'SN-001',
    });
    expect(repo.save).toHaveBeenCalledWith(device);
  });

  it('should return the saved entity on a successful insert', async () => {
    const device = makeDevice();
    repo.update.mockResolvedValue({ affected: 0 });
    repo.create.mockReturnValue(device);
    repo.save.mockResolvedValue(device);

    const result = await service.register('user-uuid', 'SN-001');

    expect(result).toBe(device);
  });
});

// ── register — 23505 race ─────────────────────────────────────────────────────

describe('BciDeviceService.register — 23505 unique-constraint race', () => {
  let service: BciDeviceService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new BciDeviceService(repo as any);
  });

  it('should re-fetch via findOneByOrFail and return the winning row when save throws QueryFailedError with code 23505', async () => {
    const device = makeDevice();
    const err = new QueryFailedError('', [], new Error('duplicate key'));
    (err as QueryFailedError & { code?: string }).code = '23505';

    repo.update.mockResolvedValue({ affected: 0 });
    repo.create.mockReturnValue(device);
    repo.save.mockRejectedValue(err);
    repo.findOneByOrFail.mockResolvedValue(device);

    const result = await service.register('user-uuid', 'SN-001');

    expect(repo.findOneByOrFail).toHaveBeenCalledWith({
      userId: 'user-uuid',
      serial: 'SN-001',
    });
    expect(result).toBe(device);
  });

  it('should propagate a QueryFailedError whose code is not 23505', async () => {
    const device = makeDevice();
    const err = new QueryFailedError('', [], new Error('other error'));
    (err as QueryFailedError & { code?: string }).code = '23000';

    repo.update.mockResolvedValue({ affected: 0 });
    repo.create.mockReturnValue(device);
    repo.save.mockRejectedValue(err);

    await expect(service.register('user-uuid', 'SN-001')).rejects.toThrow(err);
  });

  it('should propagate a QueryFailedError with an undefined code', async () => {
    const device = makeDevice();
    const err = new QueryFailedError('', [], new Error('no code'));

    repo.update.mockResolvedValue({ affected: 0 });
    repo.create.mockReturnValue(device);
    repo.save.mockRejectedValue(err);

    await expect(service.register('user-uuid', 'SN-001')).rejects.toThrow(err);
  });

  it('should propagate a non-QueryFailedError thrown by save', async () => {
    const device = makeDevice();
    const err = new Error('network failure');

    repo.update.mockResolvedValue({ affected: 0 });
    repo.create.mockReturnValue(device);
    repo.save.mockRejectedValue(err);

    await expect(service.register('user-uuid', 'SN-001')).rejects.toThrow(err);
  });
});

// ── delete ────────────────────────────────────────────────────────────────────

describe('BciDeviceService.delete', () => {
  let service: BciDeviceService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new BciDeviceService(repo as any);
  });

  it('should look up the row via findOneBy { id } and delete { id } when the user owns the device', async () => {
    const device = makeDevice({ id: 'device-uuid', userId: 'user-uuid' });
    repo.findOneBy.mockResolvedValue(device);
    repo.delete.mockResolvedValue({ affected: 1 });

    await service.delete('user-uuid', 'device-uuid');

    expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'device-uuid' });
    expect(repo.delete).toHaveBeenCalledWith({ id: 'device-uuid' });
  });

  it('should resolve with undefined on a successful delete', async () => {
    const device = makeDevice({ id: 'device-uuid', userId: 'user-uuid' });
    repo.findOneBy.mockResolvedValue(device);
    repo.delete.mockResolvedValue({ affected: 1 });

    await expect(service.delete('user-uuid', 'device-uuid')).resolves.toBeUndefined();
  });

  it('should throw RpcException with NOT_FOUND when findOneBy returns null', async () => {
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.delete('user-uuid', 'device-uuid')).rejects.toBeInstanceOf(RpcException);

    try {
      await service.delete('user-uuid', 'device-uuid');
      fail('expected RpcException');
    } catch (e) {
      expect((e as RpcException).getError()).toMatchObject({
        code: GrpcStatus.NOT_FOUND,
        message: 'BCI device not found',
      });
    }
  });

  it('should not call delete when the device is not found', async () => {
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.delete('user-uuid', 'device-uuid')).rejects.toBeInstanceOf(RpcException);

    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('should throw RpcException with PERMISSION_DENIED when row.userId !== userId', async () => {
    const device = makeDevice({ id: 'device-uuid', userId: 'other-user-uuid' });
    repo.findOneBy.mockResolvedValue(device);

    await expect(service.delete('user-uuid', 'device-uuid')).rejects.toBeInstanceOf(RpcException);

    try {
      await service.delete('user-uuid', 'device-uuid');
      fail('expected RpcException');
    } catch (e) {
      expect((e as RpcException).getError()).toMatchObject({
        code: GrpcStatus.PERMISSION_DENIED,
        message: 'BCI device belongs to another user',
      });
    }
  });

  it('should not call delete when the device belongs to another user', async () => {
    const device = makeDevice({ id: 'device-uuid', userId: 'other-user-uuid' });
    repo.findOneBy.mockResolvedValue(device);

    await expect(service.delete('user-uuid', 'device-uuid')).rejects.toBeInstanceOf(RpcException);

    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('should propagate errors thrown by delete when the user owns the device', async () => {
    const device = makeDevice({ id: 'device-uuid', userId: 'user-uuid' });
    const error = new Error('DB error during delete');
    repo.findOneBy.mockResolvedValue(device);
    repo.delete.mockRejectedValue(error);

    await expect(service.delete('user-uuid', 'device-uuid')).rejects.toThrow(error);
  });
});
