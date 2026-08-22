import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CsvImportService } from './csv-import.service';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Guarded like Employees (§4/§5). The upload endpoint streams directly to
 * disk via Multer's diskStorage (never memoryStorage) so a 20k+ row CSV is
 * never buffered fully in RAM at the HTTP layer either — see
 * EMS-BACKEND-PLAN.md §8.
 */
@ApiTags('csv-import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('csv-import')
export class CsvImportController {
  constructor(private readonly csvImportService: CsvImportService) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, callback) => {
          callback(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (extname(file.originalname).toLowerCase() !== '.csv') {
          callback(
            new BadRequestException('Only .csv files are accepted'),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected field "file")');
    }

    // Enqueues the job and returns immediately — the actual streaming
    // parse/batch-insert work (CsvImportProcessor) happens in the worker
    // process. The returned jobId is what the frontend correlates against
    // both the `csv-import.*` SSE events and GET /csv-import/:jobId/status.
    return this.csvImportService.enqueueImport(file.path, file.originalname);
  }

  @Get(':jobId/status')
  @ApiOperation({
    summary:
      "Poll a csv-import job's state/progress — fallback for a client that missed the SSE events",
  })
  async status(@Param('jobId') jobId: string) {
    const status = await this.csvImportService.getStatus(jobId);

    if (!status) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    return status;
  }
}
