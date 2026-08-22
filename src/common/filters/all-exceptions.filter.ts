import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter: normalizes every error response to a consistent
 * shape and makes sure unexpected (non-HttpException) errors never leak stack
 * traces or internal details to the client, while still being logged
 * server-side for debugging.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = isHttpException
      ? exception.getResponse()
      : 'Internal server error';

    if (!isHttpException) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const message = this.extractMessage(rawMessage);

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }

  private extractMessage(raw: string | object): string | string[] {
    if (typeof raw === 'string') {
      return raw;
    }

    if (
      typeof raw === 'object' &&
      raw !== null &&
      'message' in raw &&
      (typeof raw.message === 'string' || Array.isArray(raw.message))
    ) {
      return (raw as { message: string | string[] }).message;
    }

    return 'Internal server error';
  }
}
