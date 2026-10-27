import { SetMetadata } from '@nestjs/common';
import type { Feature } from './plan-features.js';

export const FEATURE_KEY = 'feature';

/** The company's plan must include this feature (403 FEATURE_NOT_IN_PLAN). */
export const RequireFeature = (feature: Feature) =>
  SetMetadata(FEATURE_KEY, feature);
