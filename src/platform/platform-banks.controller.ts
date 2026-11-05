import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  BankAccountsService,
  bankAccountSchema,
  planQrSchema,
  type PlanQrInput,
  updateBankAccountSchema,
  type BankAccountInput,
  type UpdateBankAccountInput,
} from '../billing/bank-accounts.service.js';
import { BillingService } from '../billing/billing.service.js';
import { ImageStoreService } from '../common/image-store.service.js';
import { ImageUpload } from '../common/uploads.controller.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { PlatformGuard, type PlatformAdminUser } from './platform-auth.js';

const id = new ParseUUIDPipe();
const rejectSlipSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});
type PlatformRequest = Request & { platformAdmin: PlatformAdminUser };

/**
 * Super Admin: the bank accounts (with QR codes) companies pay their plan into, and the
 * review of the transfer slips they send.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformBanksController {
  constructor(
    private readonly banks: BankAccountsService,
    private readonly billing: BillingService,
    private readonly images: ImageStoreService,
  ) {}

  @Get('bank-accounts')
  @ApiOperation({ summary: 'Bank accounts shown in the company pay dialog' })
  list() {
    return this.banks.list();
  }

  @Post('bank-accounts')
  @ApiZodBody(bankAccountSchema)
  create(@Body(zod(bankAccountSchema)) body: BankAccountInput) {
    return this.banks.create(body);
  }

  @Patch('bank-accounts/:id')
  @ApiZodBody(updateBankAccountSchema)
  update(
    @Param('id', id) accountId: string,
    @Body(zod(updateBankAccountSchema)) body: UpdateBankAccountInput,
  ) {
    return this.banks.update(accountId, body);
  }

  @Delete('bank-accounts/:id')
  @HttpCode(204)
  async remove(@Param('id', id) accountId: string) {
    await this.banks.remove(accountId);
  }

  @Get('plan-qrs')
  @ApiOperation({
    summary:
      'Plans with their price per period and the QR codes (amount included) saved for them',
  })
  planQrs() {
    return this.banks.planQrs();
  }

  @Put('plan-qrs')
  @ApiOperation({
    summary:
      'Save the QR of one plan, period and bank account; it records the current plan price',
  })
  @ApiZodBody(planQrSchema)
  savePlanQr(@Body(zod(planQrSchema)) body: PlanQrInput) {
    return this.banks.savePlanQr(body);
  }

  @Delete('plan-qrs/:id')
  @HttpCode(204)
  async removePlanQr(@Param('id', id) qrId: string) {
    await this.banks.removePlanQr(qrId);
  }

  @Post('uploads/bank-qr')
  @ImageUpload('QR code image of a bank account (JPEG/PNG/WebP ≤ 5 MB)')
  async uploadQr(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file)
      throw new BadRequestException('Send the image as form field "file"');
    return { url: await this.images.savePlatform(file) };
  }

  @Post('invoices/:id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Turn down the transfer slip of a pending invoice; the company sees the reason and sends a new one',
  })
  @ApiZodBody(rejectSlipSchema)
  reject(
    @Param('id', id) invoiceId: string,
    @Body(zod(rejectSlipSchema)) body: z.infer<typeof rejectSlipSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.billing.rejectSlip(
      invoiceId,
      body.reason,
      req.platformAdmin.id,
    );
  }
}
