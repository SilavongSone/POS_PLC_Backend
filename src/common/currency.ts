import { z } from 'zod';

/** The base currency: prices, stock value and reports are kept in LAK. */
export const BASE_CURRENCY = 'LAK';

/** ISO 4217 code of one of the company's currencies (Settings → Currencies), e.g. "CNY". */
export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, '3 letters, e.g. CNY');
