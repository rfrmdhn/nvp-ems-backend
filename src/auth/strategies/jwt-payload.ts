import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Shared by every Passport JWT strategy (header-based `JwtStrategy` and
 * query-param-aware `JwtSseStrategy`) so the payload -> `req.user` mapping
 * lives in exactly one place.
 */
export function toCurrentUser(payload: JwtPayload): CurrentUserPayload {
  return { id: payload.sub, email: payload.email };
}
