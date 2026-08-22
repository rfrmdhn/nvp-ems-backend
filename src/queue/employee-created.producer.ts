import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMPLOYEE_CREATED_QUEUE } from './queue.constants';

export interface EmployeeCreatedJobData {
  employeeId: string;
}

/**
 * Thin producer wrapper so EmployeesService (§5) doesn't need any BullMQ
 * imports of its own — it only knows "enqueue this employee id".
 */
@Injectable()
export class EmployeeCreatedProducer {
  constructor(
    @InjectQueue(EMPLOYEE_CREATED_QUEUE)
    private readonly queue: Queue<EmployeeCreatedJobData>,
  ) {}

  async enqueue(employeeId: string): Promise<void> {
    await this.queue.add('employee-created', { employeeId });
  }
}
