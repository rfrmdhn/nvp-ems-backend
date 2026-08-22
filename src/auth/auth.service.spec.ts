import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { admin: { findUnique: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };

  const ADMIN_EMAIL = 'admin@nusantaradigital.test';
  const ADMIN_PASSWORD = 'CorrectPassword123!';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  });

  beforeEach(async () => {
    prisma = { admin: { findUnique: jest.fn() } };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('1h') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('returns a signed access token on valid credentials', async () => {
    prisma.admin.findUnique.mockResolvedValue({
      id: 'admin-id-1',
      email: ADMIN_EMAIL,
      passwordHash,
    });

    const result = await service.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      expiresIn: '1h',
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: 'admin-id-1', email: ADMIN_EMAIL },
      { expiresIn: '1h' },
    );
  });

  it('throws UnauthorizedException for an unknown email', async () => {
    prisma.admin.findUnique.mockResolvedValue(null);

    await expect(
      service.login('nobody@nowhere.test', ADMIN_PASSWORD),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException for a wrong password', async () => {
    prisma.admin.findUnique.mockResolvedValue({
      id: 'admin-id-1',
      email: ADMIN_EMAIL,
      passwordHash,
    });

    await expect(
      service.login(ADMIN_EMAIL, 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});
