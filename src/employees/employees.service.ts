import { Injectable, NotFoundException } from '@nestjs/common';
import { Employee, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeCreatedProducer } from '../queue/employee-created.producer';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import {
  EmployeeSortBy,
  QueryEmployeesDto,
  SortOrder,
} from './dto/query-employees.dto';

export interface PaginatedEmployees {
  data: Employee[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Prisma-only data access, per EMS-BACKEND-PLAN.md §5. The only async
 * side-effect this service knows about is "enqueue a job on create" via
 * EmployeeCreatedProducer — it has no other BullMQ/queue knowledge.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeCreatedProducer: EmployeeCreatedProducer,
  ) {}

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const employee = await this.prisma.employee.create({
      data: {
        name: dto.name,
        age: dto.age,
        position: dto.position,
        salary: dto.salary,
      },
    });

    // Fire-and-forget from the caller's perspective: creation already
    // committed, the queue job just drives the async notification (§6.1).
    await this.employeeCreatedProducer.enqueue(employee.id);

    return employee;
  }

  async findAll(query: QueryEmployeesDto): Promise<PaginatedEmployees> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const sortBy = query.sortBy ?? EmployeeSortBy.CREATED_AT;
    const sortOrder = query.sortOrder ?? SortOrder.DESC;

    const where: Prisma.EmployeeWhereInput | undefined = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { position: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : undefined;

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Employee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });

    if (!employee) {
      throw new NotFoundException(`Employee ${id} not found`);
    }

    return employee;
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    // Server-side existence check by the validated :id param — the DTO never
    // carries an id, so a client can never redirect a write to another row.
    await this.findOne(id);

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.age !== undefined && { age: dto.age }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.salary !== undefined && { salary: dto.salary }),
      },
    });
  }

  async remove(id: string): Promise<Employee> {
    await this.findOne(id);
    return this.prisma.employee.delete({ where: { id } });
  }
}
