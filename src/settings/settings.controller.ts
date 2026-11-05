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
  type PipeTransform,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { currencyCode } from '../common/currency.js';
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
  currenciesSchema,
  currencyRowSchema,
  currentRatesSchema,
  paymentTypesSchema,
  registersSchema,
} from './settings.responses.js';
import { CurrenciesService } from './currencies.service.js';
import { ExchangeRatesService } from './exchange-rates.service.js';
import { PaymentTypesService } from './payment-types.service.js';
import { RegistersService } from './registers.service.js';
import {
  createCurrencySchema,
  createExchangeRateSchema,
  moveCurrencySchema,
  updateCurrencySchema,
  type CreateCurrencyInput,
  type UpdateCurrencyInput,
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

/** `:code` path parameter: an ISO 4217 code, upper-cased. */
class ParseCurrencyPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const parsed = currencyCode.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Currency code must be 3 letters',
        code: 'VALIDATION_FAILED',
      });
    return parsed.data;
  }
}
const listCurrenciesSchema = z.object({ active: queryBoolean.optional() });

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

const currencyParam = new ParseCurrencyPipe();

@ApiTags('settings')
@ApiBearerAuth()
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @ApiOperation({
    summary: 'The company currencies (?active=true for active only)',
  })
  @ApiZodQuery(listCurrenciesSchema)
  @ApiZodResponse(currenciesSchema)
  @ApiErrors(errors(SIGNED_IN, VALIDATION))
  list(@Query(zod(listCurrenciesSchema)) query: { active?: boolean }) {
    return query.active ? this.currencies.active() : this.currencies.list();
  }

  @Post()
  @RequirePermissions('exchangeRate.manage')
  @ApiOperation({ summary: 'Add a currency (optionally with its first rate)' })
  @ApiZodBody(createCurrencySchema)
  @ApiZodResponse(currencyRowSchema, { status: 201 })
  @ApiErrors(errors(SIGNED_IN, VALIDATION, { 409: ['CURRENCY_EXISTS'] }))
  create(
    @Body(zod(createCurrencySchema)) body: CreateCurrencyInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.currencies.create(body, actor.id);
  }

  @Patch(':code')
  @RequirePermissions('exchangeRate.manage')
  @ApiOperation({
    summary: 'Edit or disable a currency (LAK cannot be disabled)',
  })
  @ApiZodBody(updateCurrencySchema)
  @ApiZodResponse(currencyRowSchema)
  @ApiErrors(
    errors(SIGNED_IN, VALIDATION, {
      400: ['CURRENCY_BASE_LOCKED'],
      404: ['NOT_FOUND'],
    }),
  )
  update(
    @Param('code', currencyParam) code: string,
    @Body(zod(updateCurrencySchema)) body: UpdateCurrencyInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.currencies.update(code, body, actor.id);
  }

  @Post(':code/move')
  @HttpCode(200)
  @RequirePermissions('exchangeRate.manage')
  @ApiOperation({ summary: 'Move a currency up or down in the list' })
  @ApiZodBody(moveCurrencySchema)
  @ApiZodResponse(currenciesSchema)
  @ApiErrors(errors(SIGNED_IN, VALIDATION, { 404: ['NOT_FOUND'] }))
  move(
    @Param('code', currencyParam) code: string,
    @Body(zod(moveCurrencySchema)) body: { direction: 'up' | 'down' },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.currencies.move(code, body.direction, actor.id);
  }

  @Delete(':code')
  @HttpCode(204)
  @RequirePermissions('exchangeRate.manage')
  @ApiOperation({ summary: 'Delete a currency that was never used' })
  @ApiErrors(
    errors(SIGNED_IN, {
      400: ['CURRENCY_BASE_LOCKED'],
      404: ['NOT_FOUND'],
      409: ['CURRENCY_IN_USE'],
    }),
  )
  async remove(
    @Param('code', currencyParam) code: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.currencies.remove(code, actor.id);
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
