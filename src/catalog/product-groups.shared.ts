/** Fields every version of a model shares; editing one version updates the others. */
export const SHARED_VARIANT_FIELDS = [
  'categoryId',
  'brandId',
  'model',
  'description',
  'descriptionI18n',
  'warrantyMonths',
  'taxRateId',
] as const;
