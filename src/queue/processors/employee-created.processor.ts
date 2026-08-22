import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EMPLOYEE_CREATED_QUEUE } from '../queue.constants';
import { EmployeeCreatedJobData } from '../employee-created.producer';

/**
 * Fully implemented — this is the concrete end-to-end proof that
 * queue -> worker -> SSE actually works. See EMS-BACKEND-PLAN.md §6.1.
 *
 * `concurrency: 5` — at the default of 1, a burst of creates (e.g. a load
 * test, or several HR users creating employees back-to-back) queues up
 * behind this processor's deliberate 300ms-per-job demo delay one at a time;
 * API_Test_Report.md's stress-test run measured ~4,000 backlogged jobs
 * taking ~20 minutes to drain at concurrency 1. Processing several jobs at
 * once keeps that delay's demo purpose (still visibly async) while keeping
 * notification latency bounded under real traffic.
 */
@Processor(EMPLOYEE_CREATED_QUEUE, { concurrency: 5 })
export class EmployeeCreatedProcessor extends WorkerHost {
  private readonly logger = new Logger(EmployeeCreatedProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<EmployeeCreatedJobData>): Promise<void> {
    const { employeeId } = job.data;

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      this.logger.warn(
        `employee-created job ${job.id}: employee ${employeeId} no longer exists, skipping notification`,
      );
      return;
    }

    // Simulates whatever real post-creation work a production system would
    // do here (e.g. payroll system sync, welcome email) — see
    // EMS-BACKEND-PLAN.md §6.1. Makes the async nature visible in a demo.
    await this.delay(300);

    await this.notificationsService.notifyEmployeeCreated({
      ...employee,
      salary: employee.salary.toString(),
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
