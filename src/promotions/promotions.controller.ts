import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  createPromotionSchema,
  listPromotionsSchema,
  updatePromotionSchema,
  type CreatePromotionInput,
  type UpdatePromotionInput,
} from './promotions.schemas.js';
import { PromotionsService } from './promotions.service.js';
import { RequireFeature } from '../tenancy/require-feature.decorator.js';

const id = new ParseUUIDPipe();

@ApiTags('promotions')
@ApiBearerAuth()
@RequirePermissions('catalog.view')
@RequireFeature('promotions')
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Promotions (?current=true for the ones running now)',
  })
  list(@Query(zod(listPromotionsSchema)) q: { current?: boolean }) {
    return this.promotions.list(q.current);
  }

  @Get(':id')
  get(@Param('id', id) promotionId: string) {
    return this.promotions.get(promotionId);
  }

  @Post()
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary:
      'Percent or per-unit LAK discount for products/categories (best one applies)',
  })
  @ApiZodBody(createPromotionSchema)
  create(
    @Body(zod(createPromotionSchema)) body: CreatePromotionInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.promotions.create(body, u.id);
  }

  @Patch(':id')
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary: 'Update; sending targets replaces them; isActive=false stops it',
  })
  @ApiZodBody(updatePromotionSchema)
  update(
    @Param('id', id) promotionId: string,
    @Body(zod(updatePromotionSchema)) body: UpdatePromotionInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.promotions.update(promotionId, body, u.id);
  }
}
