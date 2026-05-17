import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from './session.service';
import { GoogleTokenService } from './google-token.service';
import { UserRole } from '../interfaces/user-role.enum';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService;
  let sessionService;
  let googleTokenService;
  let dataSource;
  let txUserRepo;
  let txManager;

  const makeUser = (overrides: Partial<User> = {}): User =>
    new User({
      id: 'uuid-1',
      email: 'test@example.com',
      name: 'Test User',
      role: UserRole.USER,
      ...overrides,
    });

  beforeEach(async () => {
    const makeQb = (result: User | null) => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(result),
    });

    txUserRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQb(null)),
      create: jest.fn(),
      save: jest.fn(),
    };

    txManager = {
      getRepository: jest.fn().mockReturnValue(txUserRepo),
    };

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: any) => Promise<any>) => cb(txManager)),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verifyAsync: jest.fn(),
    };

    sessionService = {
      create: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(undefined),
      isValid: jest.fn().mockResolvedValue(true),
    };

    googleTokenService = {
      exchangeCodeForProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: SessionService,
          useValue: sessionService,
        },
        {
          provide: GoogleTokenService,
          useValue: googleTokenService,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateToken', () => {
    it('creates a session and returns access token', async () => {
      const user = makeUser();

      const result = await service.generateToken(user);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, email: user.email }),
      );
      expect(sessionService.create).toHaveBeenCalledWith(
        'mock-jwt-token',
        user.id,
      );
      expect(result.accessToken).toBe('mock-jwt-token');
    });
  });

  describe('logout', () => {
    it('should revoke the session', async () => {
      const mockRequest = {
        headers: { authorization: 'Bearer mock-token' },
      } as any;

      await service.logout(mockRequest);

      expect(sessionService.revoke).toHaveBeenCalledWith('mock-token');
    });

    it('should not revoke if token is missing', async () => {
      const mockRequest = { headers: {} } as any;

      await service.logout(mockRequest);

      expect(sessionService.revoke).not.toHaveBeenCalled();
    });
  });

  describe('signInWithGoogle', () => {
    const mockProfile = {
      googleId: 'g-123',
      email: 'test@example.com',
      name: 'Test User',
    };

    it('should return token for existing user without creating a new one', async () => {
      const existingUser = makeUser();
      googleTokenService.exchangeCodeForProfile.mockResolvedValue(mockProfile);
      txUserRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(existingUser),
      });

      const result = await service.signInWithGoogle('valid-code');

      expect(googleTokenService.exchangeCodeForProfile).toHaveBeenCalledWith(
        'valid-code',
        undefined,
      );
      expect(txUserRepo.save).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe(mockProfile.email);
    });

    it('should create a new user when no existing user is found', async () => {
      const newUser = makeUser({ id: 'uuid-2' });
      googleTokenService.exchangeCodeForProfile.mockResolvedValue(mockProfile);
      txUserRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });
      txUserRepo.create.mockReturnValue(newUser);
      txUserRepo.save.mockResolvedValue(newUser);

      const result = await service.signInWithGoogle('valid-code');

      expect(txUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: mockProfile.email,
          name: mockProfile.name,
          role: UserRole.USER,
        }),
      );
      expect(txUserRepo.save).toHaveBeenCalledWith(newUser);
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe(mockProfile.email);
    });

    it('should propagate UnauthorizedException when Google exchange fails', async () => {
      googleTokenService.exchangeCodeForProfile.mockRejectedValue(
        new UnauthorizedException(
          'Invalid or expired Google authorization code',
        ),
      );

      await expect(service.signInWithGoogle('bad-code')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
