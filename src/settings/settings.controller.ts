import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { queryBoolean } from '../common/pagination.js';
import {
  ApiErrors,
  ApiZodQuery,
  ApiZodResponse,
  errors,
  SIGNED_IN,
  VALIDATION,
} from '../common/openapi.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  currentRatesSchema,
  paymentTypesSchema,
  registersSchema,
} from './settings.responses.js';
import { ExchangeRatesService } from './exchange-rates.service.js';
import { PaymentTypesService } from './payment-types.service.js';
import { RegistersService } from './registers.service.js';
import {
  createExchangeRateSchema,
  createPaymentTypeSchema,
  createRegisterSchema,
  createTaxRateSchema,
  listExchangeRatesSchema,
  updatePaymentTypeSchema,
  updateRegisterSchema,
  updateSettingsSchema,
  updateTaxRateSchema,
  type CreateExchangeRateInput,
  type CreatePaymentTypeInput,
  type CreateRegisterInput,
  type CreateTaxRateInput,
  type ListExchangeRatesQuery,
  type Settings,
  type UpdatePaymentTypeInput,
  type UpdateRegisterInput,
  type UpdateTaxRateInput,
} from './settings.schemas.js';
import { SettingsService } from './settings.service.js';
import { TaxRatesService } from './tax-rates.service.js';
import { RequireFeature } from '../tenancy/require-feature.decorator.js';

const id = new ParseUUIDPipe();

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Store, receipt, tax and pricing settings' })
  getAll() {
    return this.settings.getAll();
  }

  @Patch()
  @RequirePermissions('settings.manage')
  @ApiZodBody(updateSettingsSchema)
  update(
    @Body(zod(updateSettingsSchema)) body: Partial<Settings>,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settings.update(body, actor.id);
  }
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly rates: TaxRatesService) {}

  @Get()
  list() {
    return this.rates.list();
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiZodBody(createTaxRateSchema)
  create(
    @Body(zod(createTaxRateSchema)) body: CreateTaxRateInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rates.create(body, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  @ApiZodBody(updateTaxRateSchema)
  update(
    @Param('id', id) rateId: string,
    @Body(zod(updateTaxRateSchema)) body: UpdateTaxRateInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rates.update(rateId, body, actor.id);
  }

  @Post(':id/default')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Make this the VAT rate for new sales' })
  makeDefault(@Param('id', id) rateId: string, @CurrentUser() actor: AuthUser) {
    return this.rates.makeDefault(rateId, actor.id);
  }
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Get('current')
  @ApiOperation({ summary: 'Latest LAK rate per currency' })
  @ApiZodResponse(currentRatesSchema)
  @ApiErrors(errors(SIGNED_IN, { 404: ['NOT_FOUND'] }))
  current() {
    return this.rates.current();
  }

  @Get()
  @ApiOperation({ summary: 'Rate history (?currency, limit)' })
  history(@Query(zod(listExchangeRatesSchema)) query: ListExchangeRatesQuery) {
    return this.rates.history(query);
  }

  @RequireFeature('multiCurrency')
  @Post()
  @RequirePermissions('exchangeRate.manage')
  @ApiOperation({ summary: 'Set a new rate (effective immediately)' })
  @ApiZodBody(createExchangeRateSchema)
  create(
    @Body(zod(createExchangeRateSchema)) body: CreateExchangeRateInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rates.create(body, actor.id);
  }
}

const listPaymentTypesSchema = z.object({ active: queryBoolean.optional() });

@ApiTags('settings')
@ApiBearerAuth()
@Controller('payment-types')
export class PaymentTypesController {
  constructor(private readonly types: PaymentTypesService) {}

  @Get()
  @ApiOperation({ summary: 'Payment types (?active=true for the till)' })
  @ApiZodQuery(listPaymentTypesSchema)
  @ApiZodResponse(paymentTypesSchema)
  @ApiErrors(errors(VALIDATION, SIGNED_IN))
  list(@Query(zod(listPaymentTypesSchema)) query: { active?: boolean }) {
    return this.types.list(query.active ?? false);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiZodBody(createPaymentTypeSchema)
  create(
    @Body(zod(createPaymentTypeSchema)) body: CreatePaymentTypeInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.types.create(body, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Rename, reorder or switch a payment type on/off' })
  @ApiZodBody(updatePaymentTypeSchema)
  update(
    @Param('id', id) typeId: string,
    @Body(zod(updatePaymentTypeSchema)) body: UpdatePaymentTypeInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.types.update(typeId, body, actor.id);
  }
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('registers')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get()
  @ApiOperation({
    summary:
      "Registers (tills) in the user's branches, with their open shift, if any",
  })
  @ApiZodResponse(registersSchema)
  @ApiErrors(SIGNED_IN)
  list(@CurrentUser() u: AuthUser) {
    return this.registers.list(u);
  }

  @Get(':id')
  get(@Param('id', id) registerId: string, @CurrentUser() u: AuthUser) {
    return this.registers.get(registerId, u);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiZodBody(createRegisterSchema)
  create(
    @Body(zod(createRegisterSchema)) body: CreateRegisterInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.registers.create(body, actor);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  @ApiZodBody(updateRegisterSchema)
  update(
    @Param('id', id) registerId: string,
    @Body(zod(updateRegisterSchema)) body: UpdateRegisterInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.registers.update(registerId, body, actor);
  }
}
