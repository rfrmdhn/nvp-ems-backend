import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Columns `GET /employees` can sort on. Kept as an explicit allowlist (never
 * pass a client-supplied string straight into Prisma's `orderBy`) — see
 * docs/superpowers/specs/employees.md.
 */
export enum EmployeeSortBy {
  NAME = 'name',
  AGE = 'age',
  POSITION = 'position',
  SALARY = 'salary',
  CREATED_AT = 'createdAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Server-side pagination/search/sort for `GET /employees` (resolves
 * AUDIT.md's client-vs-server pagination question as server-side — a
 * 10,000+ row roster is never shipped to the browser in one response). See
 * docs/superpowers/specs/employees.md for the exact contract.
 */
export class QueryEmployeesDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 50,
    minimum: 1,
    maximum: 500,
    description: 'Page size, capped at 500 to prevent abuse.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match against name and position.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: EmployeeSortBy,
    default: EmployeeSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(EmployeeSortBy)
  sortBy?: EmployeeSortBy = EmployeeSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}
