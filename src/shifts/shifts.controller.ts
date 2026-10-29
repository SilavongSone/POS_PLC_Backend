import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import {
  ApiErrors,
  ApiZodResponse,
  errors,
  PERMISSION,
  SIGNED_IN,
  SIGNED_IN_WRITE,
  VALIDATION,
} from '../common/openapi.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { shiftSchema } from './shifts.responses.js';
import {
  cashMovementSchema,
  closeShiftSchema,
  listShiftsSchema,
  openShiftSchema,
  type CashMovementInput,
  type CloseShiftInput,
  type ListShiftsQuery,
  type OpenShiftInput,
} from './shifts.schemas.js';
import { ShiftsService } from './shifts.service.js';

const id = new ParseUUIDPipe();

@ApiTags('shifts')
@ApiBearerAuth()
@RequirePermissions('shift.operate')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post('open')
  @ApiOperation({
    summary: 'Open a shift on a register with the counted opening cash',
  })
  @ApiZodBody(openShiftSchema)
  @ApiZodResponse(shiftSchema)
  @ApiErrors(
    errors(VALIDATION, SIGNED_IN_WRITE, PERMISSION, {
      400: ['BAD_REQUEST'],
      403: ['BRANCH_FORBIDDEN'],
      404: ['NOT_FOUND'],
      409: ['CONFLICT'],
    }),
  )
  open(
    @Body(zod(openShiftSchema)) body: OpenShiftInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.shifts.open(body, u);
  }

  @Get('current')
  @ApiOperation({
    summary: "The signed-in user's open shift (empty body when none)",
  })
  @ApiZodResponse(shiftSchema, {
    description:
      'The open shift. With no open shift the body is empty (200, no JSON), not `null`.',
  })
  @ApiErrors(errors(SIGNED_IN, PERMISSION))
  async current(@CurrentUser() u: AuthUser) {
    return (await this.shifts.current(u)) ?? null;
  }

  @Get()
  @RequirePermissions('report.view')
  list(@Query(zod(listShiftsSchema)) query: ListShiftsQuery) {
    return this.shifts.list(query);
  }

  @Get(':id/report')
  @ApiOperation({
    summary: 'Z-report: sales, payments by type, expected vs counted cash',
  })
  report(@Param('id', id) shiftId: string, @CurrentUser() u: AuthUser) {
    return this.shifts.report(shiftId, u);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close with the counted cash; returns the Z-report',
  })
  @ApiZodBody(closeShiftSchema)
  close(
    @Param('id', id) shiftId: string,
    @Body(zod(closeShiftSchema)) body: CloseShiftInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.shifts.close(shiftId, body, u);
  }

  @Get(':id/cash-movements')
  cashMovements(@Param('id', id) shiftId: string) {
    return this.shifts.cashMovements(shiftId);
  }

  @Post(':id/cash-movements')
  @RequirePermissions('cash.move')
  @ApiOperation({ summary: 'Put cash into / take cash out of the drawer' })
  @ApiZodBody(cashMovementSchema)
  addCashMovement(
    @Param('id', id) shiftId: string,
    @Body(zod(cashMovementSchema)) body: CashMovementInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.shifts.addCashMovement(shiftId, body, u);
  }
}
