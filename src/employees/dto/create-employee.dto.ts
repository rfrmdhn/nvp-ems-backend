import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Siti Nurhaliza' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 28, minimum: 16, maximum: 100 })
  @IsInt()
  @Min(16)
  @Max(100)
  age!: number;

  @ApiProperty({ example: 'Software Engineer' })
  @IsString()
  @MinLength(1)
  position!: string;

  @ApiProperty({ example: 12000000, description: 'Monthly salary, in IDR' })
  @IsNumber()
  @Min(0)
  salary!: number;
}
