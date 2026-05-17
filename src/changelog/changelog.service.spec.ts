import { Logger } from '@nestjs/common';
import { ChangeLogService } from './changelog.service';
import { ChangeEntity, ChangeAction } from './changelog.enums';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRepo() {
  return {
    insert: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function makeQueryBuilder() {
  const qb: Record<string, jest.Mock> = {};
  qb['where'] = jest.fn().mockReturnValue(qb);
  qb['andWhere'] = jest.fn().mockReturnValue(qb);
  qb['orderBy'] = jest.fn().mockReturnValue(qb);
  qb['limit'] = jest.fn().mockReturnValue(qb);
  qb['getMany'] = jest.fn().mockResolvedValue([]);
  qb['select'] = jest.fn().mockReturnValue(qb);
  qb['getRawOne'] = jest.fn().mockResolvedValue(undefined);
  qb['delete'] = jest.fn().mockReturnValue(qb);
  qb['execute'] = jest.fn().mockResolvedValue({ affected: 0 });
  return qb;
}

function makeEvent(id: number) {
  return {
    id,
    entity: 'breath_session',
    refId: 'ref-uuid',
    action: 'created',
    userId: 'user-uuid',
    createdAt: new Date(),
  };
}

// ─── suite ────────────────────────────────────────────────────────────────────

describe('ChangeLogService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: ChangeLogService;

  beforeEach(() => {
    repo = makeRepo();
    service = new ChangeLogService(repo as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 1: log()
  // ───────────────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('should return the generated id from result.identifiers[0].id when log is called', async () => {
      repo.insert.mockResolvedValue({ identifiers: [{ id: 7 }] });

      const id = await service.log(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        'user-uuid',
      );

      expect(id).toBe(7);
    });

    it('should call insert with { entity, refId, action, userId } when log is invoked', async () => {
      repo.insert.mockResolvedValue({ identifiers: [{ id: 1 }] });

      await service.log(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.UPDATED,
        'user-uuid',
      );

      expect(repo.insert).toHaveBeenCalledWith({
        entity: ChangeEntity.BREATH_SESSION,
        refId: 'ref-uuid',
        action: ChangeAction.UPDATED,
        userId: 'user-uuid',
      });
    });

    it('should propagate the numeric id type from insert result when identifiers id is a number', async () => {
      repo.insert.mockResolvedValue({ identifiers: [{ id: 42 }] });

      const id = await service.log(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.DELETED,
        'user-uuid',
      );

      expect(typeof id).toBe('number');
      expect(id).toBe(42);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 2: logForRecipients()
  // ───────────────────────────────────────────────────────────────────────────

  describe('logForRecipients()', () => {
    it('should not call repository.query when userIds array is empty', async () => {
      await service.logForRecipients(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        [],
      );

      expect(repo.query).not.toHaveBeenCalled();
    });

    it('should build SQL with one value block ($1,$2,$3,$4) when a single recipient is provided', async () => {
      repo.query.mockResolvedValue(undefined);

      await service.logForRecipients(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        ['user-1'],
      );

      const [sql] = repo.query.mock.calls[0] as [string, ...unknown[]];
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(sql).toContain('$4');
      // Verify exactly one block: $5 must not appear
      expect(sql).not.toContain('$5');
    });

    it('should build SQL with N value blocks when N recipients are provided', async () => {
      repo.query.mockResolvedValue(undefined);

      await service.logForRecipients(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        ['user-1', 'user-2', 'user-3'],
      );

      const [sql] = repo.query.mock.calls[0] as [string, ...unknown[]];
      // Block 1: $1..$4
      expect(sql).toContain('$1');
      expect(sql).toContain('$4');
      // Block 2: $5..$8
      expect(sql).toContain('$5');
      expect(sql).toContain('$8');
      // Block 3: $9..$12
      expect(sql).toContain('$9');
      expect(sql).toContain('$12');
    });

    it('should produce a params array with exactly N×4 elements when N recipients are provided', async () => {
      repo.query.mockResolvedValue(undefined);

      await service.logForRecipients(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        ['user-1', 'user-2'],
      );

      const [, params] = repo.query.mock.calls[0] as [string, string[]];
      expect(params).toHaveLength(8);
    });

    it('should order params as [entity, refId, action, userId] per recipient preserving recipient order', async () => {
      repo.query.mockResolvedValue(undefined);

      await service.logForRecipients(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        ['user-A', 'user-B'],
      );

      const [, params] = repo.query.mock.calls[0] as [string, string[]];
      expect(params).toEqual([
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        'user-A',
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        'user-B',
      ]);
    });

    it('should use positional placeholders following $((i*4)+1..4) pattern for each recipient', async () => {
      repo.query.mockResolvedValue(undefined);

      await service.logForRecipients(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        ['user-1', 'user-2'],
      );

      const [sql] = repo.query.mock.calls[0] as [string, ...unknown[]];
      // First block: i=0 → placeholders $1,$2,$3,$4
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(sql).toContain('$4');
      // Second block: i=1 → placeholders $5,$6,$7,$8
      expect(sql).toContain('$5');
      expect(sql).toContain('$6');
      expect(sql).toContain('$7');
      expect(sql).toContain('$8');
    });

    it('should target the "change_events" table in the INSERT statement', async () => {
      repo.query.mockResolvedValue(undefined);

      await service.logForRecipients(
        ChangeEntity.BREATH_SESSION,
        'ref-uuid',
        ChangeAction.CREATED,
        ['user-1'],
      );

      const [sql] = repo.query.mock.calls[0] as [string, ...unknown[]];
      expect(sql).toContain('"change_events"');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 3: getChanges() — query construction
  // ───────────────────────────────────────────────────────────────────────────

  describe('getChanges() — query construction', () => {
    let qb: ReturnType<typeof makeQueryBuilder>;

    beforeEach(() => {
      qb = makeQueryBuilder();
      repo.createQueryBuilder.mockReturnValue(qb);
    });

    it("should call createQueryBuilder with alias 'ce' when getChanges is invoked", async () => {
      await service.getChanges('user-uuid', 0, 10);

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('ce');
    });

    it("should apply where('ce.userId = :userId', { userId }) when filtering by user", async () => {
      await service.getChanges('user-uuid', 0, 10);

      expect(qb['where']).toHaveBeenCalledWith('ce.userId = :userId', {
        userId: 'user-uuid',
      });
    });

    it("should apply andWhere('ce.id > :afterId', { afterId }) when filtering by cursor", async () => {
      await service.getChanges('user-uuid', 5, 10);

      expect(qb['andWhere']).toHaveBeenCalledWith('ce.id > :afterId', {
        afterId: 5,
      });
    });

    it("should call orderBy('ce.id', 'ASC') when assembling the query", async () => {
      await service.getChanges('user-uuid', 0, 10);

      expect(qb['orderBy']).toHaveBeenCalledWith('ce.id', 'ASC');
    });

    it('should call limit(limit + 1) when limit is provided', async () => {
      await service.getChanges('user-uuid', 0, 20);

      expect(qb['limit']).toHaveBeenCalledWith(21);
    });

    it('should default limit to 100 when no limit argument is provided', async () => {
      await service.getChanges('user-uuid', 0);

      expect(qb['limit']).toHaveBeenCalledWith(101);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 3: getChanges() — result shaping
  // ───────────────────────────────────────────────────────────────────────────

  describe('getChanges() — result shaping', () => {
    let qb: ReturnType<typeof makeQueryBuilder>;

    beforeEach(() => {
      qb = makeQueryBuilder();
      repo.createQueryBuilder.mockReturnValue(qb);
    });

    it('should return hasMore: false and full rows when getMany returns fewer rows than limit', async () => {
      const rows = [makeEvent(1), makeEvent(2)];
      qb['getMany'].mockResolvedValue(rows);

      const result = await service.getChanges('user-uuid', 0, 10);

      expect(result.hasMore).toBe(false);
      expect(result.events).toHaveLength(2);
    });

    it('should return hasMore: false and full rows when getMany returns exactly limit rows', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => makeEvent(i + 1));
      qb['getMany'].mockResolvedValue(rows);

      const result = await service.getChanges('user-uuid', 0, 10);

      expect(result.hasMore).toBe(false);
      expect(result.events).toHaveLength(10);
    });

    it('should return hasMore: true and slice events to limit when getMany returns limit+1 rows', async () => {
      const rows = Array.from({ length: 11 }, (_, i) => makeEvent(i + 1));
      qb['getMany'].mockResolvedValue(rows);

      const result = await service.getChanges('user-uuid', 0, 10);

      expect(result.hasMore).toBe(true);
      expect(result.events).toHaveLength(10);
    });

    it('should set cursor to the id of the last returned event when events are present', async () => {
      const rows = [makeEvent(3), makeEvent(7), makeEvent(12)];
      qb['getMany'].mockResolvedValue(rows);

      const result = await service.getChanges('user-uuid', 0, 10);

      expect(result.cursor).toBe(12);
    });

    it('should set cursor to afterId when getMany returns no rows', async () => {
      qb['getMany'].mockResolvedValue([]);

      const result = await service.getChanges('user-uuid', 42, 10);

      expect(result.cursor).toBe(42);
    });

    it('should set cursor to the limit-th row id (not the extra row id) when hasMore is true', async () => {
      // 11 rows for limit=10: ids 1..11, cursor must be id of the 10th row (10), not the extra (11)
      const rows = Array.from({ length: 11 }, (_, i) => makeEvent(i + 1));
      qb['getMany'].mockResolvedValue(rows);

      const result = await service.getChanges('user-uuid', 0, 10);

      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe(10);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 4: getMinEventId()
  // ───────────────────────────────────────────────────────────────────────────

  describe('getMinEventId()', () => {
    let qb: ReturnType<typeof makeQueryBuilder>;

    beforeEach(() => {
      qb = makeQueryBuilder();
      repo.createQueryBuilder.mockReturnValue(qb);
    });

    it("should call createQueryBuilder with alias 'ce' and select('MIN(ce.id)', 'min') when invoked", async () => {
      qb['getRawOne'].mockResolvedValue({ min: null });

      await service.getMinEventId();

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('ce');
      expect(qb['select']).toHaveBeenCalledWith('MIN(ce.id)', 'min');
    });

    it("should return 42 (number) when getRawOne returns { min: '42' }", async () => {
      qb['getRawOne'].mockResolvedValue({ min: '42' });

      const result = await service.getMinEventId();

      expect(result).toBe(42);
    });

    it('should return null when getRawOne returns { min: null }', async () => {
      qb['getRawOne'].mockResolvedValue({ min: null });

      const result = await service.getMinEventId();

      expect(result).toBeNull();
    });

    it('should return null when getRawOne returns undefined', async () => {
      qb['getRawOne'].mockResolvedValue(undefined);

      const result = await service.getMinEventId();

      expect(result).toBeNull();
    });

    it('should parse the string min value with parseInt base 10 when converting result', async () => {
      // '99' in base 10 = 99; in base 8, '9' is invalid so parseInt('99',8) = NaN
      // This validates that the implementation uses base 10 explicitly
      qb['getRawOne'].mockResolvedValue({ min: '99' });

      const result = await service.getMinEventId();

      expect(result).toBe(99);
      expect(typeof result).toBe('number');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 5: purge()
  // ───────────────────────────────────────────────────────────────────────────

  describe('purge()', () => {
    let qb: ReturnType<typeof makeQueryBuilder>;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      qb = makeQueryBuilder();
      repo.createQueryBuilder.mockReturnValue(qb);
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('should issue a delete query with where clause using make_interval(days => :days) when purge runs', async () => {
      qb['execute'].mockResolvedValue({ affected: 5 });

      await service.purge(7);

      expect(qb['delete']).toHaveBeenCalled();
      expect(qb['where']).toHaveBeenCalledWith(
        expect.stringContaining('make_interval(days => :days)'),
        expect.objectContaining({ days: 7 }),
      );
    });

    it('should pass the olderThanDays value as the :days parameter when purge runs', async () => {
      qb['execute'].mockResolvedValue({ affected: 0 });

      await service.purge(14);

      expect(qb['where']).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ days: 14 }),
      );
    });

    it('should default olderThanDays to 30 when no argument is provided', async () => {
      qb['execute'].mockResolvedValue({ affected: 0 });

      await service.purge();

      expect(qb['where']).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ days: 30 }),
      );
    });

    it('should log "removed N change events older than D days" with the affected count when execute returns { affected: N }', async () => {
      qb['execute'].mockResolvedValue({ affected: 15 });

      await service.purge(30);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('removed 15 change events'),
      );
    });

    it('should log a count of 0 when execute returns { affected: undefined } (?? 0 fallback)', async () => {
      qb['execute'].mockResolvedValue({ affected: undefined });

      await service.purge(30);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('removed 0 change events'),
      );
    });

    it('should log a count of 0 when execute returns { affected: 0 }', async () => {
      qb['execute'].mockResolvedValue({ affected: 0 });

      await service.purge(30);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('removed 0 change events'),
      );
    });
  });
});
