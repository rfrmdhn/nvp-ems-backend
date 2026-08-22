import { ApiProperty } from '@nestjs/swagger';

/**
 * Documents the ACTUAL wire shape of an Employee row, not the Prisma model.
 * `salary` is a Prisma `Decimal` with no custom JSON serializer, so it
 * round-trips as a numeric STRING (e.g. "12000000"), not a `number` — the
 * frontend normalizes it on read. See docs/superpowers/specs/employees.md.
 */
export class EmployeeResponseDto {
  @ApiProperty({ example: '22a55bcd-0399-461e-8939-d05657c78a96' })
  id!: string;

  @ApiProperty({ example: 'Siti Nurhaliza' })
  name!: string;

  @ApiProperty({ example: 28 })
  age!: number;

  @ApiProperty({ example: 'Software Engineer' })
  position!: string;

  @ApiProperty({
    example: '12000000',
    description:
      'Monthly salary, in IDR. Serialized as a numeric STRING (Prisma Decimal has no custom JSON serializer), not a number.',
  })
  salary!: string;

  @ApiProperty({ example: '2026-08-20T07:01:08.750Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-20T07:01:08.791Z' })
  updatedAt!: string;
}

export class PaginatedEmployeesResponseDto {
  @ApiProperty({ type: [EmployeeResponseDto] })
  data!: EmployeeResponseDto[];

  @ApiProperty({
    example: 23,
    description: 'Count matching the `search` filter, not the whole table.',
  })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
