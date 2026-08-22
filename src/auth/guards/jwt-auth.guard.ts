import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Applied at the controller-class level (not per-method) on every Employees
 * and CSV-import controller, so a newly added route can never ship unguarded
 * by accident. See EMS-BACKEND-PLAN.md §4.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
