import { Global, Module } from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service.js';
import { PaymentTypesService } from './payment-types.service.js';
import { RegistersService } from './registers.service.js';
import {
  ExchangeRatesController,
  PaymentTypesController,
  RegistersController,
  SettingsController,
  TaxRatesController,
} from './settings.controller.js';
import { SettingsService } from './settings.service.js';
import { TaxRatesService } from './tax-rates.service.js';

/** Global: pricing, sales and receipts all read settings, rates and VAT. */
@Global()
@Module({
  controllers: [
    SettingsController,
    TaxRatesController,
    ExchangeRatesController,
    PaymentTypesController,
    RegistersController,
  ],
  providers: [
    SettingsService,
    TaxRatesService,
    ExchangeRatesService,
    PaymentTypesService,
    RegistersService,
  ],
  exports: [
    SettingsService,
    TaxRatesService,
    ExchangeRatesService,
    PaymentTypesService,
  ],
})
export class SettingsModule {}
