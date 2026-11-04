import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ApiZodResponse } from '../common/openapi.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { productGroupSchema } from './catalog.responses.js';
import {
  createProductGroupSchema,
  newVariantSchema,
  updateProductGroupSchema,
  type CreateProductGroupInput,
  type NewVariantInput,
  type UpdateProductGroupInput,
} from './product-groups.schemas.js';
import { ProductGroupsService } from './product-groups.service.js';

const id = new ParseUUIDPipe();

@ApiTags('catalog')
@ApiBearerAuth()
@RequirePermissions('catalog.view')
@Controller('product-groups')
export class ProductGroupsController {
  constructor(private readonly groups: ProductGroupsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'A model and its versions (USB+WiFi / USB+LAN …)' })
  @ApiZodResponse(productGroupSchema)
  get(@Param('id', id) groupId: string) {
    return this.groups.get(groupId);
  }

  @Post()
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary:
      'Make products versions of one model (the first gives category, brand, description and warranty) and add new versions copied from it',
  })
  @ApiZodBody(createProductGroupSchema)
  @ApiZodResponse(productGroupSchema, { status: 201 })
  create(
    @Body(zod(createProductGroupSchema)) body: CreateProductGroupInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groups.create(body, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary:
      'Rename the model or its option, rename and order versions (names follow)',
  })
  @ApiZodBody(updateProductGroupSchema)
  @ApiZodResponse(productGroupSchema)
  update(
    @Param('id', id) groupId: string,
    @Body(zod(updateProductGroupSchema)) body: UpdateProductGroupInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groups.update(groupId, body, actor.id);
  }

  @Post(':id/variants')
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary: 'New version copied from another one (own SKU, barcode and stock)',
  })
  @ApiZodBody(newVariantSchema)
  @ApiZodResponse(productGroupSchema, { status: 201 })
  addVariant(
    @Param('id', id) groupId: string,
    @Body(zod(newVariantSchema)) body: NewVariantInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groups.addVariant(groupId, body, actor.id);
  }

  @Delete(':id/variants/:productId')
  @HttpCode(204)
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary: 'Take a product out of the model (it stays a normal product)',
  })
  async removeVariant(
    @Param('id', id) groupId: string,
    @Param('productId', id) productId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.groups.removeVariant(groupId, productId, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('product.manage')
  @ApiOperation({ summary: 'Ungroup: every version stays a normal product' })
  async remove(
    @Param('id', id) groupId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.groups.remove(groupId, actor.id);
  }
}
