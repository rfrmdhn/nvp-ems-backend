import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { NotificationEvent } from './notification-event.interface';

const CHANNEL = 'ems:notifications';

/**
 * Backs the `/notifications/stream` SSE endpoint. See EMS-BACKEND-PLAN.md §7
 * and §7.1: the `employee-created` (and future `csv-import`) processors run
 * in the separate `worker` process, so job-completion events are bridged from
 * worker -> api via a Redis pub/sub channel; the api process fans them out to
 * every connected SSE client through this in-memory RxJS Subject.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly subject = new Subject<NotificationEvent>();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  readonly stream$: Observable<NotificationEvent> = this.subject.asObservable();

  constructor(private readonly configService: ConfigService) {
    const redisOptions = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null as unknown as number,
      lazyConnect: true,
    };

    // ioredis requires a dedicated connection while in subscribe mode, so
    // publishing and subscribing each get their own client.
    this.publisher = new Redis(redisOptions);
    this.subscriber = new Redis(redisOptions);

    // Never let a transient Redis outage crash the process with an unhandled
    // 'error' event — log and let ioredis's own reconnect logic handle it.
    this.publisher.on('error', (err) =>
      this.logger.warn(`Redis publisher error: ${err.message}`),
    );
    this.subscriber.on('error', (err) =>
      this.logger.warn(`Redis subscriber error: ${err.message}`),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.subscriber
      .connect()
      .catch((err: unknown) =>
        this.logger.warn(
          `Redis subscriber connect failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    await this.publisher
      .connect()
      .catch((err: unknown) =>
        this.logger.warn(
          `Redis publisher connect failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as NotificationEvent;
        this.subject.next(event);
      } catch (error) {
        this.logger.warn(
          `Failed to parse notification message: ${String(error)}`,
        );
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.subject.complete();
    await this.subscriber.quit().catch(() => undefined);
    await this.publisher.quit().catch(() => undefined);
  }

  /** Called by EmployeeCreatedProcessor once a job finishes processing. */
  async notifyEmployeeCreated(employee: unknown): Promise<void> {
    await this.publish({
      type: 'employee.created',
      data: employee,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Called by CsvImportProcessor after every batch flush (see
   * EMS-BACKEND-PLAN.md §8 and docs/superpowers/plans/csv-import.md's
   * "Progress reporting" section) — one event per batch, not per row, so the
   * SSE stream isn't flooded on a 20,000+ row file.
   */
  async notifyCsvImportProgress(
    jobId: string,
    progress: {
      processed: number;
      total: number;
      percent: number;
      rowsProcessed: number;
    },
  ): Promise<void> {
    await this.publish({
      type: 'csv-import.progress',
      data: { jobId, ...progress },
      timestamp: new Date().toISOString(),
    });
  }

  /** Called by CsvImportProcessor once the job resolves. */
  async notifyCsvImportCompleted(
    jobId: string,
    summary: { imported: number; skipped: number; errors: string[] },
  ): Promise<void> {
    await this.publish({
      type: 'csv-import.completed',
      data: { jobId, ...summary },
      timestamp: new Date().toISOString(),
    });
  }

  /** Called by CsvImportProcessor if the job throws before it can resolve. */
  async notifyCsvImportFailed(jobId: string, error: string): Promise<void> {
    await this.publish({
      type: 'csv-import.failed',
      data: { jobId, error },
      timestamp: new Date().toISOString(),
    });
  }

  private async publish(event: NotificationEvent): Promise<void> {
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
  }
}
