import { PartialType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/**
 * Deliberately has no `id` field — the row to update is always taken from
 * the validated `:id` route param, never from the request body, so a client
 * can never redirect a write to a different row.
 */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
