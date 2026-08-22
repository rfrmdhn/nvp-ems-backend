import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CsvUploadResponseDto {
  @ApiProperty({
    example: '2',
    description:
      'BullMQ job id — correlate against SSE events and the status endpoint.',
  })
  jobId!: string;
}

export class CsvImportStatusResponseDto {
  @ApiProperty({ example: '2' })
  jobId!: string;

  @ApiProperty({
    example: 'completed',
    description:
      'BullMQ job state: waiting | active | completed | failed | ...',
  })
  state!: string;

  @ApiPropertyOptional({
    example: 831,
    description:
      'Bytes of the source file read so far (percent is computed from this).',
  })
  processed?: number;

  @ApiPropertyOptional({
    example: 831,
    description: 'Total bytes of the source file.',
  })
  total?: number;

  @ApiPropertyOptional({ example: 100 })
  percent?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Actual CSV row count processed so far.',
  })
  rowsProcessed?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Populated once state is "completed".',
  })
  imported?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Populated once state is "completed".',
  })
  skipped?: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Per-row error reasons; populated on "completed" (skipped rows) or "failed".',
  })
  errors?: string[];
}
