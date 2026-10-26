import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import type { TicketStatus } from '../generated/prisma/client.js';
import {
  createTicketSchema,
  deliverTicketSchema,
  listTicketsSchema,
  ticketLinesSchema,
  ticketStatusSchema,
  updateTicketSchema,
  type CreateTicketInput,
  type DeliverTicketInput,
  type ListTicketsQuery,
  type TicketLinesInput,
  type UpdateTicketInput,
} from './repairs.schemas.js';
import { RepairsService } from './repairs.service.js';

const id = new ParseUUIDPipe();

@ApiTags('repairs')
@ApiBearerAuth()
@RequirePermissions('repair.receive')
@Controller('service-tickets')
export class RepairsController {
  constructor(private readonly repairs: RepairsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Repair tickets (?status, open, customerId, q ticket/serial/device/phone)',
  })
  list(@Query(zod(listTicketsSchema)) query: ListTicketsQuery) {
    return this.repairs.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Ticket with lines, history and print data (receipt / quotation / bill)',
  })
  get(@Param('id', id) ticketId: string) {
    return this.repairs.get(ticketId);
  }

  @Post()
  @ApiOperation({
    summary: 'Receive a device for repair or warranty claim (T-YYMMDD-0001)',
  })
  @ApiZodBody(createTicketSchema)
  create(
    @Body(zod(createTicketSchema)) body: CreateTicketInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.repairs.create(body, u);
  }

  @Patch(':id')
  @RequirePermissions('repair.manage')
  @ApiOperation({
    summary: 'Diagnosis, promised date, warranty given on the repair, vendor',
  })
  @ApiZodBody(updateTicketSchema)
  update(
    @Param('id', id) ticketId: string,
    @Body(zod(updateTicketSchema)) body: UpdateTicketInput,
  ) {
    return this.repairs.update(ticketId, body);
  }

  @Put(':id/lines')
  @RequirePermissions('repair.manage')
  @ApiOperation({ summary: 'Set the repair quotation: parts and labour' })
  @ApiZodBody(ticketLinesSchema)
  setLines(
    @Param('id', id) ticketId: string,
    @Body(zod(ticketLinesSchema)) body: TicketLinesInput,
  ) {
    return this.repairs.setLines(ticketId, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('repair.manage')
  @ApiZodBody(ticketStatusSchema)
  setStatus(
    @Param('id', id) ticketId: string,
    @Body(zod(ticketStatusSchema))
    body: { status: TicketStatus; note?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.repairs.setStatus(ticketId, body.status, body.note, u);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequirePermissions('repair.receive', 'sale.create')
  @ApiOperation({
    summary:
      'Hand back; charges the repair through a sale unless under warranty',
  })
  @ApiZodBody(deliverTicketSchema)
  deliver(
    @Param('id', id) ticketId: string,
    @Body(zod(deliverTicketSchema)) body: DeliverTicketInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.repairs.deliver(ticketId, body, u);
  }
}
