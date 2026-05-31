import * as crypto from 'crypto';
import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthCodeService } from './auth-code.service';
import { AuthCode } from '../entities/auth-code.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../interfaces/user-role.enum';

const hashOf = (c: string): string =>
  crypto.createHash('sha256').update(c).digest('hex');

const makeAuthCode = (overrides: Partial<AuthCode> = {}): AuthCode =>
  Object.assign(new AuthCode(), {
    id: 'code-uuid',
    email: 'test@example.com',
    codeHash: hashOf('123456'),
    used: false,
    failedAttempts: 0,
    lockedUntil: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  });

const makeUser = (overrides: Partial<User> = {}): User =>
  new User({
    id: 'user-uuid',
    email: 'test@example.com',
    name: 'test',
    role: UserRole.USER,
    ...overrides,
  });

describe('AuthCodeService', () => {
  let service: AuthCodeService;
  let authCodeRepository: jest.Mocked<any>;
  let dataSource: jest.Mocked<any>;
  let mailService: jest.Mocked<any>;
  let authService: jest.Mocked<any>;
  let manager: jest.Mocked<any>;
  let authCodeRepo: jest.Mocked<any>;
  let userRepo: jest.Mocked<any>;

  beforeEach(() => {
    authCodeRepo = {
      createQueryBuilder: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      save: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };

    manager = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === AuthCode) return authCodeRepo;
        if (entity === User) return userRepo;
        return authCodeRepo;
      }),
      save: jest.fn(),
    };

    authCodeRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: any) => Promise<any>) => cb(manager)),
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === User) return userRepo;
        return authCodeRepo;
      }),
    };

    mailService = {
      sendAuthCode: jest.fn().mockResolvedValue(undefined),
    };

    authService = {
      generateToken: jest
        .fn()
        .mockResolvedValue({ accessToken: 'jwt-token', user: {} }),
    };

    service = new AuthCodeService(
      authCodeRepository,
      dataSource,
      mailService,
      authService,
    );
  });

  // ─────────────────────────────────────────────
  // sendCode
  // ─────────────────────────────────────────────
  describe('sendCode', () => {
    const makeQb = (recentCode: AuthCode | null) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(recentCode),
    });

    it('throws 429 when a code was sent within the cooldown window', async () => {
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(makeAuthCode()));

      await expect(service.sendCode('test@example.com')).rejects.toThrow(
        new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
      );
      expect(mailService.sendAuthCode).not.toHaveBeenCalled();
    });

    it('deletes old codes and sends a new one on success', async () => {
      const savedCode = makeAuthCode({ id: 'saved-id' });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      authCodeRepo.create.mockReturnValue(savedCode);
      authCodeRepo.save.mockResolvedValue(savedCode);

      await service.sendCode('Test@Example.com');

      expect(authCodeRepo.delete).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
      expect(mailService.sendAuthCode).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        expect.any(String),
      );
    });

    it('deletes the saved code and rethrows when mail sending fails', async () => {
      const savedCode = makeAuthCode({ id: 'saved-id' });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      authCodeRepo.create.mockReturnValue(savedCode);
      authCodeRepo.save.mockResolvedValue(savedCode);
      mailService.sendAuthCode.mockRejectedValue(new Error('SMTP error'));

      await expect(service.sendCode('test@example.com')).rejects.toThrow(
        'SMTP error',
      );
      expect(authCodeRepository.delete).toHaveBeenCalledWith({
        id: 'saved-id',
      });
    });

    it('normalizes email to lowercase', async () => {
      const savedCode = makeAuthCode({ id: 'saved-id' });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      authCodeRepo.create.mockReturnValue(savedCode);
      authCodeRepo.save.mockResolvedValue(savedCode);

      await service.sendCode('UPPER@EXAMPLE.COM');

      expect(mailService.sendAuthCode).toHaveBeenCalledWith(
        'upper@example.com',
        expect.any(String),
        expect.any(String),
      );
    });

    it('uses the existing user language when the user is already registered', async () => {
      const savedCode = makeAuthCode({ id: 'saved-id' });
      userRepo.findOne.mockResolvedValue({ language: 'ru' });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      authCodeRepo.create.mockReturnValue(savedCode);
      authCodeRepo.save.mockResolvedValue(savedCode);

      await service.sendCode('test@example.com', 'en');

      expect(mailService.sendAuthCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'ru',
      );
    });

    it('uses request locale for a new user', async () => {
      const savedCode = makeAuthCode({ id: 'saved-id' });
      userRepo.findOne.mockResolvedValue(null);
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      authCodeRepo.create.mockReturnValue(savedCode);
      authCodeRepo.save.mockResolvedValue(savedCode);

      await service.sendCode('test@example.com', 'ru');

      expect(mailService.sendAuthCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'ru',
      );
    });

    it('falls back to en when no locale and user is new', async () => {
      const savedCode = makeAuthCode({ id: 'saved-id' });
      userRepo.findOne.mockResolvedValue(null);
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      authCodeRepo.create.mockReturnValue(savedCode);
      authCodeRepo.save.mockResolvedValue(savedCode);

      await service.sendCode('test@example.com');

      expect(mailService.sendAuthCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'en',
      );
    });
  });

  // ─────────────────────────────────────────────
  // verifyCode
  // ─────────────────────────────────────────────
  describe('verifyCode', () => {
    const makeQb = (authCode: AuthCode | null) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(authCode),
    });

    it('throws UnauthorizedException for invalid or expired code', async () => {
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(null));

      await expect(
        service.verifyCode('test@example.com', '000000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('marks the code as used and returns a token for an existing user', async () => {
      const code = makeAuthCode({ codeHash: hashOf('123456'), used: false });
      const user = makeUser();
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(code));
      manager.save.mockResolvedValue({ ...code, used: true });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.verifyCode('test@example.com', '123456');

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ used: true }),
      );
      expect(authService.generateToken).toHaveBeenCalledWith(user);
      expect(result.accessToken).toBe('jwt-token');
    });

    it('creates a new user when the email is not registered yet', async () => {
      const code = makeAuthCode({
        email: 'new@example.com',
        codeHash: hashOf('123456'),
      });
      const newUser = makeUser({
        id: 'new-uuid',
        email: 'new@example.com',
        name: 'new',
      });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(code));
      manager.save.mockResolvedValue({ ...code, used: true });
      userRepo.findOne.mockResolvedValue(null);
      userRepo.save.mockResolvedValue(newUser);

      await service.verifyCode('new@example.com', '123456');

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
      expect(authService.generateToken).toHaveBeenCalledWith(newUser);
    });

    it('uses the part before @ as the new user name', async () => {
      const code = makeAuthCode({
        email: 'alice@domain.com',
        codeHash: hashOf('123456'),
      });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(code));
      manager.save.mockResolvedValue({ ...code, used: true });
      userRepo.findOne.mockResolvedValue(null);
      userRepo.save.mockImplementation(async (u: User) => u);

      await service.verifyCode('alice@domain.com', '123456');

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'alice' }),
      );
    });

    it('normalizes email to lowercase before lookup', async () => {
      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      authCodeRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.verifyCode('TEST@EXAMPLE.COM', '000000'),
      ).rejects.toThrow(UnauthorizedException);

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('codeHash'),
        expect.anything(),
      );
      expect(qb.where).toHaveBeenCalledWith('ac.email = :email', {
        email: 'test@example.com',
      });
    });

    it('does not create a user if one already exists (no duplicate)', async () => {
      const code = makeAuthCode({ codeHash: hashOf('123456') });
      const existingUser = makeUser();
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(code));
      manager.save.mockResolvedValue({ ...code, used: true });
      userRepo.findOne.mockResolvedValue(existingUser);

      await service.verifyCode('test@example.com', '123456');

      expect(userRepo.save).not.toHaveBeenCalled();
      expect(authService.generateToken).toHaveBeenCalledWith(existingUser);
    });

    it('throws UnauthorizedException on hash mismatch and increments failedAttempts', async () => {
      const code = makeAuthCode({
        codeHash: hashOf('999999'),
        failedAttempts: 0,
      });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(code));
      manager.save.mockResolvedValue(undefined);

      await expect(
        service.verifyCode('test@example.com', '123456'),
      ).rejects.toThrow(UnauthorizedException);

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ failedAttempts: 1 }),
      );
    });

    it('sets lockedUntil on the 5th failed attempt', async () => {
      const code = makeAuthCode({
        codeHash: hashOf('999999'),
        failedAttempts: 4,
      });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(code));
      manager.save.mockResolvedValue(undefined);

      await expect(
        service.verifyCode('test@example.com', '123456'),
      ).rejects.toThrow(UnauthorizedException);

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failedAttempts: 5,
          lockedUntil: expect.any(Date),
        }),
      );

      const savedArg = manager.save.mock.calls[0][0];
      expect(savedArg.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws 429 and skips token generation when code is locked', async () => {
      const code = makeAuthCode({
        lockedUntil: new Date(Date.now() + 60_000),
      });
      authCodeRepo.createQueryBuilder.mockReturnValue(makeQb(code));

      await expect(
        service.verifyCode('test@example.com', '123456'),
      ).rejects.toThrow(
        new HttpException(
          'Too many attempts, request a new code',
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );

      expect(authService.generateToken).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ used: true }),
      );
    });
  });

  // ─────────────────────────────────────────────
  // cleanupExpiredCodes
  // ─────────────────────────────────────────────
  describe('cleanupExpiredCodes', () => {
    it('deletes expired codes', async () => {
      authCodeRepository.delete.mockResolvedValue({ affected: 7 });

      await service.cleanupExpiredCodes();

      expect(authCodeRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: expect.anything() }),
      );
    });

    it('handles zero deleted rows gracefully', async () => {
      authCodeRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.cleanupExpiredCodes()).resolves.not.toThrow();
    });
  });
});
