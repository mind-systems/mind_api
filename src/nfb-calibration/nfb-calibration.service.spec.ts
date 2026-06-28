import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { NfbCalibrationService } from './nfb-calibration.service';
import { NfbCalibrationRecord } from './entities/nfb-calibration-record.entity';
import { RecordNfbCalibrationRequest } from '../../proto/generated/nfb_calibration';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRepo() {
  return {
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
  };
}

function makeReq(
  overrides: Partial<RecordNfbCalibrationRequest> = {},
): RecordNfbCalibrationRequest {
  return {
    deviceSerial: 'SN-001',
    calibratedAt: '2024-01-15T10:00:00.000Z',
    isValid: true,
    failReason: '',
    individualFrequency: 10.5,
    individualPeakFrequency: 10.2,
    individualPeakFrequencyPower: 1.5,
    individualPeakFrequencySuppression: 0.8,
    individualBandwidth: 2.0,
    individualNormalizedPower: 0.6,
    lowerFrequency: 8.0,
    upperFrequency: 13.0,
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<NfbCalibrationRecord> = {},
): NfbCalibrationRecord {
  return Object.assign(new NfbCalibrationRecord(), {
    id: 'record-uuid',
    userId: 'user-uuid',
    deviceSerial: 'SN-001',
    calibratedAt: new Date('2024-01-15T10:00:00.000Z'),
    isValid: true,
    failReason: null,
    individualFrequency: 10.5,
    individualPeakFrequency: 10.2,
    individualPeakFrequencyPower: 1.5,
    individualPeakFrequencySuppression: 0.8,
    individualBandwidth: 2.0,
    individualNormalizedPower: 0.6,
    lowerFrequency: 8.0,
    upperFrequency: 13.0,
    createdAt: new Date('2024-01-15T10:00:00.000Z'),
    ...overrides,
  });
}

// ── record() — valid path ──────────────────────────────────────────────────────

describe('NfbCalibrationService.record — valid path', () => {
  let service: NfbCalibrationService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new NfbCalibrationService(repo as any);
  });

  it('should create and save a record when calibratedAt is a valid ISO timestamp', async () => {
    const entity = makeRecord();
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    await expect(service.record('user-uuid', makeReq())).resolves.not.toThrow();

    expect(repo.create).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  it('should return the entity resolved by repo.save', async () => {
    const entity = makeRecord();
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    const result = await service.record('user-uuid', makeReq());

    expect(result).toBe(entity);
  });

  it('should pass all request fields through to repo.create when saving', async () => {
    const req = makeReq({ isValid: false });
    const entity = makeRecord();
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    await service.record('user-uuid', req);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-uuid',
        deviceSerial: req.deviceSerial,
        isValid: req.isValid,
        individualFrequency: req.individualFrequency,
        individualPeakFrequency: req.individualPeakFrequency,
        individualPeakFrequencyPower: req.individualPeakFrequencyPower,
        individualPeakFrequencySuppression:
          req.individualPeakFrequencySuppression,
        individualBandwidth: req.individualBandwidth,
        individualNormalizedPower: req.individualNormalizedPower,
        lowerFrequency: req.lowerFrequency,
        upperFrequency: req.upperFrequency,
      }),
    );
  });

  it('should convert calibratedAt string into a Date instance passed to repo.create', async () => {
    const calibratedAt = '2024-06-01T12:00:00.000Z';
    const req = makeReq({ calibratedAt });
    const entity = makeRecord();
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    await service.record('user-uuid', req);

    const [createArg] = repo.create.mock.calls[0];
    expect(createArg.calibratedAt).toBeInstanceOf(Date);
    expect(createArg.calibratedAt.toISOString()).toBe(calibratedAt);
  });
});

// ── record() — failReason mapping ─────────────────────────────────────────────

describe('NfbCalibrationService.record — failReason mapping', () => {
  let service: NfbCalibrationService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new NfbCalibrationService(repo as any);
  });

  it('should set failReason to null when request failReason is an empty string', async () => {
    const req = makeReq({ failReason: '' });
    const entity = makeRecord();
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    await service.record('user-uuid', req);

    const [createArg] = repo.create.mock.calls[0];
    expect(createArg.failReason).toBeNull();
  });

  it('should set failReason to null when request failReason is undefined', async () => {
    const req = makeReq({ failReason: undefined as any });
    const entity = makeRecord();
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    await service.record('user-uuid', req);

    const [createArg] = repo.create.mock.calls[0];
    expect(createArg.failReason).toBeNull();
  });

  it('should preserve failReason when request provides a non-empty string', async () => {
    const req = makeReq({ failReason: 'tooManyArtifacts' });
    const entity = makeRecord();
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    await service.record('user-uuid', req);

    const [createArg] = repo.create.mock.calls[0];
    expect(createArg.failReason).toBe('tooManyArtifacts');
  });
});

// ── record() — invalid timestamp guard ────────────────────────────────────────

describe('NfbCalibrationService.record — invalid timestamp guard', () => {
  let service: NfbCalibrationService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new NfbCalibrationService(repo as any);
  });

  it('should throw RpcException with code INVALID_ARGUMENT when calibratedAt is not a valid date string', async () => {
    const req = makeReq({ calibratedAt: 'not-a-date' });

    await expect(service.record('user-uuid', req)).rejects.toBeInstanceOf(
      RpcException,
    );

    try {
      await service.record('user-uuid', req);
      fail('expected RpcException');
    } catch (e) {
      expect((e as RpcException).getError()).toMatchObject({
        code: GrpcStatus.INVALID_ARGUMENT,
      });
    }
  });

  it('should throw RpcException with message "Invalid calibratedAt timestamp" when calibratedAt parses to NaN', async () => {
    const req = makeReq({ calibratedAt: 'not-a-date' });

    try {
      await service.record('user-uuid', req);
      fail('expected RpcException');
    } catch (e) {
      expect((e as RpcException).getError()).toMatchObject({
        message: 'Invalid calibratedAt timestamp',
      });
    }
  });

  it('should not call repo.create when calibratedAt is invalid', async () => {
    const req = makeReq({ calibratedAt: 'not-a-date' });

    await expect(service.record('user-uuid', req)).rejects.toBeInstanceOf(
      RpcException,
    );

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('should not call repo.save when calibratedAt is invalid', async () => {
    const req = makeReq({ calibratedAt: 'not-a-date' });

    await expect(service.record('user-uuid', req)).rejects.toBeInstanceOf(
      RpcException,
    );

    expect(repo.save).not.toHaveBeenCalled();
  });
});

// ── list() — where clause construction ────────────────────────────────────────

describe('NfbCalibrationService.list — where clause construction', () => {
  let service: NfbCalibrationService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new NfbCalibrationService(repo as any);
    repo.findAndCount.mockResolvedValue([[], 0]);
  });

  it('should query findAndCount with where userId only when deviceSerial is undefined', async () => {
    await service.list('user-uuid', undefined);

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.where).toEqual({ userId: 'user-uuid' });
    expect(opts.where).not.toHaveProperty('deviceSerial');
  });

  it('should omit deviceSerial from the where clause when deviceSerial is an empty string', async () => {
    await service.list('user-uuid', '');

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.where).toEqual({ userId: 'user-uuid' });
    expect(opts.where).not.toHaveProperty('deviceSerial');
  });

  it('should include deviceSerial in the where clause when deviceSerial is non-empty', async () => {
    await service.list('user-uuid', 'SN-001');

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.where).toEqual({ userId: 'user-uuid', deviceSerial: 'SN-001' });
  });

  it('should include deviceSerial when deviceSerial is a single character', async () => {
    await service.list('user-uuid', 'X');

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.where).toEqual({ userId: 'user-uuid', deviceSerial: 'X' });
  });
});

// ── list() — pagination, limit cap, ordering ──────────────────────────────────

describe('NfbCalibrationService.list — pagination, limit cap, ordering', () => {
  let service: NfbCalibrationService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new NfbCalibrationService(repo as any);
    repo.findAndCount.mockResolvedValue([[], 0]);
  });

  it('should order by createdAt DESC', async () => {
    await service.list('user-uuid');

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.order).toEqual({ createdAt: 'DESC' });
  });

  it('should use the provided limit as take when limit is between 1 and 200', async () => {
    await service.list('user-uuid', undefined, 100);

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.take).toBe(100);
  });

  it('should default take to 50 when limit is 0', async () => {
    await service.list('user-uuid', undefined, 0);

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.take).toBe(50);
  });

  it('should default take to 50 when limit is negative', async () => {
    await service.list('user-uuid', undefined, -5);

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.take).toBe(50);
  });

  it('should default take to 50 when limit argument is omitted', async () => {
    await service.list('user-uuid');

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.take).toBe(50);
  });

  it('should cap take at 200 when limit exceeds 200', async () => {
    await service.list('user-uuid', undefined, 999);

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.take).toBe(200);
  });

  it('should pass offset as the skip value', async () => {
    await service.list('user-uuid', undefined, 50, 25);

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.skip).toBe(25);
  });

  it('should default skip to 0 when offset argument is omitted', async () => {
    await service.list('user-uuid');

    const [opts] = repo.findAndCount.mock.calls[0];
    expect(opts.skip).toBe(0);
  });
});

// ── list() — result passthrough ───────────────────────────────────────────────

describe('NfbCalibrationService.list — result passthrough', () => {
  let service: NfbCalibrationService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    service = new NfbCalibrationService(repo as any);
  });

  it('should return the [records, count] tuple resolved by findAndCount', async () => {
    const records = [makeRecord(), makeRecord({ id: 'other-uuid' })];
    repo.findAndCount.mockResolvedValue([records, 2]);

    const result = await service.list('user-uuid');

    expect(result).toEqual([records, 2]);
  });

  it('should return an empty array with count 0 when no records match', async () => {
    repo.findAndCount.mockResolvedValue([[], 0]);

    const result = await service.list('user-uuid');

    expect(result).toEqual([[], 0]);
  });

  it('should propagate the error when findAndCount rejects', async () => {
    const error = new Error('DB error');
    repo.findAndCount.mockRejectedValue(error);

    await expect(service.list('user-uuid')).rejects.toThrow(error);
  });
});
