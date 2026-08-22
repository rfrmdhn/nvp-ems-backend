import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginResponseDto } from './dto/login-response.dto';

/**
 * See EMS-BACKEND-PLAN.md §4. Login intentionally returns the same generic
 * "Invalid credentials" error for both "no such admin" and "wrong password"
 * so the API never leaks which half of the credential pair was wrong.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, admin.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '1h');

    const accessToken = await this.jwtService.signAsync(
      { sub: admin.id, email: admin.email },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- env-driven `ms`-style string, validated at bootstrap
      { expiresIn: expiresIn as any },
    );

    return { accessToken, expiresIn };
  }
}
