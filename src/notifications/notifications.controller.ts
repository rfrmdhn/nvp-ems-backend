import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { NotificationsService } from './notifications.service';

/**
 * Guarded by the 'jwt-sse' strategy (JwtSseStrategy), not the usual
 * JwtAuthGuard/'jwt' — native `EventSource` can't set an Authorization
 * header, so this route accepts the JWT via a `?token=` query param (falling
 * back to the standard header for curl/Postman). See
 * docs/superpowers/AUDIT.md #4 and src/auth/strategies/jwt-sse.strategy.ts.
 * This is the ONLY route that accepts a query-string token — every other
 * route keeps using the header-only guard unchanged.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Sse('stream')
  @UseGuards(AuthGuard('jwt-sse'))
  @ApiOperation({
    summary:
      'Server-Sent Events stream of job-completion notifications (employee.created, csv-import.completed). Requires ?token=<jwt> since EventSource cannot set headers.',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description:
      'JWT access token (from POST /auth/login). Required because native EventSource cannot send an Authorization header.',
  })
  stream(): Observable<MessageEvent> {
    // `data` is the raw notification payload (e.g. the created employee), not
    // the whole NotificationEvent envelope — `type`/`id` carry the envelope's
    // metadata at the SSE transport level so the frontend never has to unwrap
    // a nested `data.data`.
    return this.notificationsService.stream$.pipe(
      map(
        (event) =>
          ({
            type: event.type,
            id: event.timestamp,
            data: event.data,
          }) as MessageEvent,
      ),
    );
  }
}
