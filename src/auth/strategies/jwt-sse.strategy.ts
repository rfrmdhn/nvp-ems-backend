import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { JwtPayload, toCurrentUser } from './jwt-payload';

/**
 * Registered as 'jwt-sse' and applied ONLY to `GET /notifications/stream`
 * (see NotificationsController) — every other route keeps using the
 * header-only 'jwt' strategy (JwtStrategy/JwtAuthGuard) unchanged.
 *
 * Native `EventSource` cannot set custom headers, so a browser client has no
 * way to send `Authorization: Bearer <jwt>` on this one request. The
 * well-established workaround is a `?token=` query-string param; the
 * extractor below checks that first (the EventSource case) and falls back to
 * the standard Bearer header (so curl/Postman testing keeps working). This
 * exception is deliberately scoped to this single endpoint — query-string
 * tokens are more likely to leak into logs/browser history than headers, so
 * no other route should accept a token this way. See
 * docs/superpowers/AUDIT.md #4.
 */
@Injectable()
export class JwtSseStrategy extends PassportStrategy(Strategy, 'jwt-sse') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request): string | null =>
          (req?.query?.token as string | undefined) || null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') as string,
    });
  }

  validate(payload: JwtPayload): CurrentUserPayload {
    return toCurrentUser(payload);
  }
}
