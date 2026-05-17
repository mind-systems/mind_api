import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { PersonalAccessTokenService } from './personal-access-token.service';
import { PersonalAccessToken } from '../entities/personal-access-token.entity';
import { User } from '../entities/user.entity';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('PersonalAccessTokenService', () => {
  let service: PersonalAccessTokenService;
  let patRepo: jest.Mocked<Record<string, jest.Mock>>;
  let userRepo: jest.Mocked<Record<string, jest.Mock>>;

  const USER_ID = 'user-uuid-1';
  const PAT_ID = 'pat-uuid-1';
  const PAT_NAME = 'My Token';
  const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');

  beforeEach(async () => {
    patRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalAccessTokenService,
        {
          provide: getRepositoryToken(PersonalAccessToken),
          useValue: patRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
      ],
    }).compile();

    service = module.get<PersonalAccessTokenService>(PersonalAccessTokenService);
  });

  // ---------------------------------------------------------------------------
  // Phase 1: create()
  // ---------------------------------------------------------------------------

  describe('create()', () => {
    describe('token generation and shape', () => {
      let result: { token: string; id: string; name: string; createdAt: Date };

      beforeEach(async () => {
        const entity = { id: PAT_ID, name: PAT_NAME, createdAt: CREATED_AT } as PersonalAccessToken;
        patRepo.create.mockReturnValue(entity);
        patRepo.save.mockResolvedValue(entity);

        result = await service.create(USER_ID, PAT_NAME);
      });

      it('should return a token matching /^pat_[0-9a-f]{64}$/ when create is called', () => {
        expect(result.token).toMatch(/^pat_[0-9a-f]{64}$/);
      });

      it('should return response with shape { token, id, name, createdAt } when create succeeds', () => {
        expect(result).toHaveProperty('token');
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('createdAt');
      });

      it('should NOT include tokenHash in the response when create succeeds', () => {
        expect(result).not.toHaveProperty('tokenHash');
      });

      it('should return different tokens when create is called twice consecutively', async () => {
        const entity = { id: PAT_ID, name: PAT_NAME, createdAt: CREATED_AT } as PersonalAccessToken;
        patRepo.create.mockReturnValue(entity);
        patRepo.save.mockResolvedValue(entity);

        const result1 = await service.create(USER_ID, PAT_NAME);
        const result2 = await service.create(USER_ID, PAT_NAME);

        expect(result1.token).not.toBe(result2.token);
      });
    });

    describe('persistence stores only the hash', () => {
      it('should call patRepo.create() with { userId, tokenHash, name } when create is called', async () => {
        const entity = { id: PAT_ID, name: PAT_NAME, createdAt: CREATED_AT } as PersonalAccessToken;
        patRepo.create.mockReturnValue(entity);
        patRepo.save.mockResolvedValue(entity);

        const result = await service.create(USER_ID, PAT_NAME);

        const capturedArg = patRepo.create.mock.calls[0][0];
        const expectedHash = sha256(result.token);

        expect(capturedArg).toMatchObject({
          userId: USER_ID,
          tokenHash: expectedHash,
          name: PAT_NAME,
        });
      });

      it('should pass the SHA-256 hash and NOT the raw token to patRepo.create() when create is called', async () => {
        const entity = { id: PAT_ID, name: PAT_NAME, createdAt: CREATED_AT } as PersonalAccessToken;
        patRepo.create.mockReturnValue(entity);
        patRepo.save.mockResolvedValue(entity);

        const result = await service.create(USER_ID, PAT_NAME);

        const capturedArg = patRepo.create.mock.calls[0][0];

        expect(capturedArg.tokenHash).not.toBe(result.token);
      });

      it('should call patRepo.save() with the entity returned by patRepo.create() when create succeeds', async () => {
        const entity = { id: PAT_ID, name: PAT_NAME, createdAt: CREATED_AT } as PersonalAccessToken;
        patRepo.create.mockReturnValue(entity);
        patRepo.save.mockResolvedValue(entity);

        await service.create(USER_ID, PAT_NAME);

        expect(patRepo.save).toHaveBeenCalledWith(entity);
      });

      it('should use the saved entity\'s id and createdAt in the response when create succeeds', async () => {
        const savedId = 'saved-uuid-999';
        const savedCreatedAt = new Date('2025-06-15T12:00:00.000Z');
        const entity = { id: savedId, name: PAT_NAME, createdAt: savedCreatedAt } as PersonalAccessToken;
        patRepo.create.mockReturnValue(entity);
        patRepo.save.mockResolvedValue(entity);

        const result = await service.create(USER_ID, PAT_NAME);

        expect(result.id).toBe(savedId);
        expect(result.createdAt).toBe(savedCreatedAt);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 2: list()
  // ---------------------------------------------------------------------------

  describe('list()', () => {
    it('should call patRepo.find() with correct options when list is called', async () => {
      patRepo.find.mockResolvedValue([]);

      await service.list(USER_ID);

      expect(patRepo.find).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        order: { createdAt: 'DESC' },
        select: ['id', 'name', 'createdAt', 'lastUsedAt'],
      });
    });

    it('should return the array produced by patRepo.find() when list is called', async () => {
      const tokens = [
        { id: 'id-1', name: 'Token 1', createdAt: CREATED_AT, lastUsedAt: null },
        { id: 'id-2', name: 'Token 2', createdAt: CREATED_AT, lastUsedAt: null },
      ] as PersonalAccessToken[];
      patRepo.find.mockResolvedValue(tokens);

      const result = await service.list(USER_ID);

      expect(result).toBe(tokens);
    });

    it('should return an empty array when patRepo.find() resolves to []', async () => {
      patRepo.find.mockResolvedValue([]);

      const result = await service.list(USER_ID);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 3: revoke()
  // ---------------------------------------------------------------------------

  describe('revoke()', () => {
    it('should call patRepo.delete() with { id, userId } when revoke is called', async () => {
      patRepo.delete.mockResolvedValue({ affected: 1 });

      await service.revoke(PAT_ID, USER_ID);

      expect(patRepo.delete).toHaveBeenCalledWith({ id: PAT_ID, userId: USER_ID });
    });

    it('should resolve without error when patRepo.delete() returns { affected: 1 }', async () => {
      patRepo.delete.mockResolvedValue({ affected: 1 });

      await expect(service.revoke(PAT_ID, USER_ID)).resolves.toBeUndefined();
    });

    it('should throw NotFoundException when patRepo.delete() returns { affected: 0 }', async () => {
      patRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(service.revoke(PAT_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when patRepo.delete() returns { affected: undefined }', async () => {
      patRepo.delete.mockResolvedValue({ affected: undefined });

      await expect(service.revoke(PAT_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 4: validateToken()
  // ---------------------------------------------------------------------------

  describe('validateToken()', () => {
    const RAW_TOKEN = 'pat_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    describe('lookup by hash', () => {
      it('should call patRepo.findOne() with { where: { tokenHash: sha256(rawToken) } } when validateToken is called', async () => {
        patRepo.findOne.mockResolvedValue(null);

        await service.validateToken(RAW_TOKEN);

        const expectedHash = sha256(RAW_TOKEN);
        expect(patRepo.findOne).toHaveBeenCalledWith({ where: { tokenHash: expectedHash } });
      });

      it('should NOT pass the raw token to patRepo.findOne() when validateToken is called', async () => {
        patRepo.findOne.mockResolvedValue(null);

        await service.validateToken(RAW_TOKEN);

        const callArg = patRepo.findOne.mock.calls[0][0];
        expect(JSON.stringify(callArg)).not.toContain(RAW_TOKEN);
      });
    });

    describe('null-return paths', () => {
      it('should return null when patRepo.findOne() resolves to null', async () => {
        patRepo.findOne.mockResolvedValue(null);

        const result = await service.validateToken(RAW_TOKEN);

        expect(result).toBeNull();
      });

      it('should return null when userRepo.findOne() resolves to null', async () => {
        const pat = { id: PAT_ID, userId: USER_ID } as PersonalAccessToken;
        patRepo.findOne.mockResolvedValue(pat);
        userRepo.findOne.mockResolvedValue(null);

        const result = await service.validateToken(RAW_TOKEN);

        expect(result).toBeNull();
      });

      it('should NOT throw when the associated user is missing', async () => {
        const pat = { id: PAT_ID, userId: USER_ID } as PersonalAccessToken;
        patRepo.findOne.mockResolvedValue(pat);
        userRepo.findOne.mockResolvedValue(null);

        await expect(service.validateToken(RAW_TOKEN)).resolves.not.toThrow();
      });

      it('should NOT call userRepo.findOne() when patRepo.findOne() returns null', async () => {
        patRepo.findOne.mockResolvedValue(null);

        await service.validateToken(RAW_TOKEN);

        expect(userRepo.findOne).not.toHaveBeenCalled();
      });

      it('should NOT call patRepo.update() when patRepo.findOne() returns null', async () => {
        patRepo.findOne.mockResolvedValue(null);

        await service.validateToken(RAW_TOKEN);

        expect(patRepo.update).not.toHaveBeenCalled();
      });

      it('should NOT call patRepo.update() when userRepo.findOne() returns null', async () => {
        const pat = { id: PAT_ID, userId: USER_ID } as PersonalAccessToken;
        patRepo.findOne.mockResolvedValue(pat);
        userRepo.findOne.mockResolvedValue(null);

        await service.validateToken(RAW_TOKEN);

        expect(patRepo.update).not.toHaveBeenCalled();
      });
    });

    describe('success path', () => {
      const mockUser = new User({
        id: USER_ID,
        email: 'test@example.com',
        name: 'Test User',
      });
      const mockPat = { id: PAT_ID, userId: USER_ID } as PersonalAccessToken;

      beforeEach(() => {
        patRepo.findOne.mockResolvedValue(mockPat);
        userRepo.findOne.mockResolvedValue(mockUser);
        patRepo.update.mockResolvedValue(undefined);
      });

      it('should return { sub: user.id, email: user.email, name: user.name } when token and user are found', async () => {
        const result = await service.validateToken(RAW_TOKEN);

        expect(result).toEqual({
          sub: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
        });
      });

      it('should call userRepo.findOne() with { where: { id: pat.userId } } when token is found', async () => {
        await service.validateToken(RAW_TOKEN);

        expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: mockPat.userId } });
      });

      it('should call patRepo.update() with ({ id: pat.id }, { lastUsedAt: expect.any(Date) }) when validation succeeds', async () => {
        await service.validateToken(RAW_TOKEN);

        expect(patRepo.update).toHaveBeenCalledWith(
          { id: mockPat.id },
          { lastUsedAt: expect.any(Date) },
        );
      });

      it('should return a payload with sub (not id) on the JwtPayload when validation succeeds', async () => {
        const result = await service.validateToken(RAW_TOKEN);

        expect(result).toHaveProperty('sub');
        expect(result).not.toHaveProperty('id');
      });
    });
  });
});
