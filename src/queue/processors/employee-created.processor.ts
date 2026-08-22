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
 */
@Processor(EMPLOYEE_CREATED_QUEUE)
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
