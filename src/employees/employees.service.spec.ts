import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeCreatedProducer } from '../queue/employee-created.producer';
import { EmployeeSortBy, SortOrder } from './dto/query-employees.dto';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: {
    employee: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let employeeCreatedProducer: { enqueue: jest.Mock };

  const sampleEmployee = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Siti Nurhaliza',
    age: 28,
    position: 'Software Engineer',
    salary: '12000000',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    employeeCreatedProducer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeeCreatedProducer, useValue: employeeCreatedProducer },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  describe('create', () => {
    it('inserts the employee and enqueues an employee-created job', async () => {
      prisma.employee.create.mockResolvedValue(sampleEmployee);

      const result = await service.create({
        name: 'Siti Nurhaliza',
        age: 28,
        position: 'Software Engineer',
        salary: 12000000,
      });

      expect(prisma.employee.create).toHaveBeenCalledWith({
        data: {
          name: 'Siti Nurhaliza',
          age: 28,
          position: 'Software Engineer',
          salary: 12000000,
        },
      });
      expect(employeeCreatedProducer.enqueue).toHaveBeenCalledWith(
        sampleEmployee.id,
      );
      expect(result).toEqual(sampleEmployee);
    });
  });

  describe('findAll', () => {
    it('returns a paginated list with defaults (page 1, limit 50, createdAt desc)', async () => {
      prisma.employee.findMany.mockResolvedValue([sampleEmployee]);
      prisma.employee.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
      });
      expect(prisma.employee.count).toHaveBeenCalledWith({ where: undefined });
      expect(result).toEqual({
        data: [sampleEmployee],
        total: 1,
        page: 1,
        limit: 50,
      });
    });

    it('computes skip/take from page and limit', async () => {
      prisma.employee.findMany.mockResolvedValue([sampleEmployee]);
      prisma.employee.count.mockResolvedValue(1);

      await service.findAll({ page: 3, limit: 10 });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('applies a case-insensitive search filter against name and position', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.count.mockResolvedValue(0);

      await service.findAll({ search: 'engineer' });

      const expectedWhere = {
        OR: [
          { name: { contains: 'engineer', mode: 'insensitive' } },
          { position: { contains: 'engineer', mode: 'insensitive' } },
        ],
      };
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.employee.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('sorts by the requested column and direction', async () => {
      prisma.employee.findMany.mockResolvedValue([sampleEmployee]);
      prisma.employee.count.mockResolvedValue(1);

      await service.findAll({
        sortBy: EmployeeSortBy.SALARY,
        sortOrder: SortOrder.ASC,
      });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { salary: 'asc' } }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the employee when found', async () => {
      prisma.employee.findUnique.mockResolvedValue(sampleEmployee);

      const result = await service.findOne(sampleEmployee.id);

      expect(result).toEqual(sampleEmployee);
    });

    it('throws NotFoundException when missing', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates an existing employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(sampleEmployee);
      prisma.employee.update.mockResolvedValue({
        ...sampleEmployee,
        name: 'Updated Name',
      });

      const result = await service.update(sampleEmployee.id, {
        name: 'Updated Name',
      });

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: sampleEmployee.id },
        data: { name: 'Updated Name' },
      });
      expect(result.name).toBe('Updated Name');
    });

    it('throws NotFoundException when the row does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an existing employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(sampleEmployee);
      prisma.employee.delete.mockResolvedValue(sampleEmployee);

      const result = await service.remove(sampleEmployee.id);

      expect(prisma.employee.delete).toHaveBeenCalledWith({
        where: { id: sampleEmployee.id },
      });
      expect(result).toEqual(sampleEmployee);
    });

    it('throws NotFoundException when the row does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.employee.delete).not.toHaveBeenCalled();
    });
  });
});
