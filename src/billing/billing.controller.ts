import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { pageQuerySchema } from '../common/pagination.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { BillingService, webhookBodySchema } from './billing.service.js';

const id = new ParseUUIDPipe();
export const checkoutSchema = z.object({
  planCode: z.string().trim().toUpperCase().min(1).max(30),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
});
export const listInvoicesSchema = pageQuerySchema.extend({
  status: z.enum(['PENDING', 'PAID', 'CANCELLED']).optional(),
});

/** The company pays for its plan. Usable while read-only, so an expired company can renew. */
@ApiTags('billing')
@ApiBearerAuth()
@RequirePermissions('settings.manage')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  list(@Query(zod(listInvoicesSchema)) q: z.infer<typeof listInvoicesSchema>) {
    return this.billing.list(q);
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Invoice for 1/3/6/12 months of a plan, with how to pay it',
  })
  @ApiZodBody(checkoutSchema)
  checkout(
    @Body(zod(checkoutSchema)) body: z.infer<typeof checkoutSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.checkout(body.planCode, body.months, user.id);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', id) invoiceId: string, @CurrentUser() user: AuthUser) {
    return this.billing.cancel(invoiceId, user.id);
  }
}

/** Called by the payment gateway (or its adapter). */
@ApiTags('public')
@Public()
@Controller('public/billing')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Payment confirmation: header X-Signature: sha256=<hex HMAC-SHA256 of the body with BILLING_WEBHOOK_SECRET>',
  })
  @ApiZodBody(webhookBodySchema)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature?: string,
  ) {
    return this.billing.webhook(req.rawBody, signature);
  }
}
