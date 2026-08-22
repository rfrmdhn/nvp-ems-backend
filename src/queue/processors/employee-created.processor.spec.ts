import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { EmployeeCreatedProcessor } from './employee-created.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

describe('EmployeeCreatedProcessor', () => {
  let processor: EmployeeCreatedProcessor;
  let prisma: { employee: { findUnique: jest.Mock } };
  let notificationsService: { notifyEmployeeCreated: jest.Mock };

  const sampleEmployee = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Siti Nurhaliza',
    age: 28,
    position: 'Software Engineer',
    salary: { toString: () => '12000000' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = { employee: { findUnique: jest.fn() } };
    notificationsService = {
      notifyEmployeeCreated: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeCreatedProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    processor = module.get<EmployeeCreatedProcessor>(EmployeeCreatedProcessor);
  });

  it('looks up the employee and pushes an SSE notification with its data', async () => {
    prisma.employee.findUnique.mockResolvedValue(sampleEmployee);

    const job = {
      id: 'job-1',
      data: { employeeId: sampleEmployee.id },
    } as Job<{ employeeId: string }>;

    await processor.process(job);

    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: sampleEmployee.id },
    });
    expect(notificationsService.notifyEmployeeCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sampleEmployee.id,
        name: sampleEmployee.name,
        salary: '12000000',
      }),
    );
  });

  it('skips the notification if the employee no longer exists', async () => {
    prisma.employee.findUnique.mockResolvedValue(null);

    const job = {
      id: 'job-2',
      data: { employeeId: 'missing-id' },
    } as Job<{ employeeId: string }>;

    await processor.process(job);

    expect(notificationsService.notifyEmployeeCreated).not.toHaveBeenCalled();
  });
});
