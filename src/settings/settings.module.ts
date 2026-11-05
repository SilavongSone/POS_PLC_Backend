import { Global, Module } from '@nestjs/common';
import { CurrenciesService } from './currencies.service.js';
import { ExchangeRatesService } from './exchange-rates.service.js';
import { PaymentTypesService } from './payment-types.service.js';
import { RegistersService } from './registers.service.js';
import {
  CurrenciesController,
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
    CurrenciesController,
    ExchangeRatesController,
    PaymentTypesController,
    RegistersController,
  ],
  providers: [
    SettingsService,
    TaxRatesService,
    CurrenciesService,
    ExchangeRatesService,
    PaymentTypesService,
    RegistersService,
  ],
  exports: [
    SettingsService,
    TaxRatesService,
    CurrenciesService,
    ExchangeRatesService,
    PaymentTypesService,
  ],
})
export class SettingsModule {}
