import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Prisma's `salary` column is `@db.Decimal(14, 2)` — Postgres rejects
// anything whose absolute value rounds to >= 10^12 ("numeric field
// overflow"). Matching that bound here turns that case into a normal 400
// instead of an uncaught PrismaClientUnknownRequestError surfacing as a 500.
const MAX_SALARY = 999_999_999_999.99;

// Rejects ASCII control characters (0x00-0x1F, 0x7F) anywhere in the string.
// A NUL byte specifically makes Postgres reject the whole insert at the
// encoding level ("invalid byte sequence for encoding UTF8: 0x00"), which
// @IsString() alone doesn't catch — this stops it at validation instead of
// letting it reach the database as an uncaught error.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const NO_CONTROL_CHARACTERS = /^[^\x00-\x1F\x7F]*$/;

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Siti Nurhaliza' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'name must not contain control characters',
  })
  name!: string;

  @ApiProperty({ example: 28, minimum: 16, maximum: 100 })
  @IsInt()
  @Min(16)
  @Max(100)
  age!: number;

  @ApiProperty({ example: 'Software Engineer' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'position must not contain control characters',
  })
  position!: string;

  @ApiProperty({
    example: 12000000,
    description: 'Monthly salary, in IDR',
    maximum: MAX_SALARY,
  })
  @IsNumber()
  @Min(0)
  @Max(MAX_SALARY)
  salary!: number;
}
