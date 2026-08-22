import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import {
  EmployeeResponseDto,
  PaginatedEmployeesResponseDto,
} from './dto/employee-response.dto';

/**
 * Guarded at the controller-class level (not per-method), per
 * EMS-BACKEND-PLAN.md §4/§5 — a newly added route can never ship unguarded.
 */
@ApiTags('employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @ApiResponse({ status: 201, type: EmployeeResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Get()
  @ApiResponse({ status: 200, type: PaginatedEmployeesResponseDto })
  findAll(@Query() query: QueryEmployeesDto) {
    return this.employeesService.findAll(query);
  }

  @Get(':id')
  @ApiResponse({ status: 200, type: EmployeeResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.findOne(id);
  }

  @Put(':id')
  @ApiResponse({ status: 200, type: EmployeeResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(id, dto);
  }

  @Delete(':id')
  @ApiResponse({ status: 200, type: EmployeeResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.remove(id);
  }
}
