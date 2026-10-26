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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { hasPermission } from '../common/permissions.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { BrandsService } from './brands.service.js';
import {
  bulkPriceSchema,
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  listCategoriesSchema,
  listProductsSchema,
  lookupSchema,
  reorderImagesSchema,
  setPricesSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateProductSchema,
  type BulkPriceInput,
  type CreateBrandInput,
  type CreateCategoryInput,
  type CreateProductInput,
  type ListProductsQuery,
  type SetPricesInput,
  type UpdateBrandInput,
  type UpdateCategoryInput,
  type UpdateProductInput,
} from './catalog.schemas.js';
import { CategoriesService } from './categories.service.js';
import { MAX_IMAGE_BYTES, ProductsService } from './products.service.js';

const id = new ParseUUIDPipe();
const canViewCost = (user: AuthUser) =>
  hasPermission(user.permissions, 'product.viewCost');

@ApiTags('catalog')
@ApiBearerAuth()
@RequirePermissions('catalog.view')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Categories (flat, or nested with ?tree=true)' })
  list(@Query(zod(listCategoriesSchema)) query: { tree?: boolean }) {
    return query.tree ? this.categories.tree() : this.categories.list();
  }

  @Post()
  @RequirePermissions('product.manage')
  @ApiZodBody(createCategorySchema)
  create(
    @Body(zod(createCategorySchema)) body: CreateCategoryInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.categories.create(body, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('product.manage')
  @ApiZodBody(updateCategorySchema)
  update(
    @Param('id', id) categoryId: string,
    @Body(zod(updateCategorySchema)) body: UpdateCategoryInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.categories.update(categoryId, body, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('product.manage')
  async remove(
    @Param('id', id) categoryId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.categories.remove(categoryId, actor.id);
  }
}

@ApiTags('catalog')
@ApiBearerAuth()
@RequirePermissions('catalog.view')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  list() {
    return this.brands.list();
  }

  @Post()
  @RequirePermissions('product.manage')
  @ApiZodBody(createBrandSchema)
  create(
    @Body(zod(createBrandSchema)) body: CreateBrandInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.brands.create(body, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('product.manage')
  @ApiZodBody(updateBrandSchema)
  update(
    @Param('id', id) brandId: string,
    @Body(zod(updateBrandSchema)) body: UpdateBrandInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.brands.update(brandId, body, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('product.manage')
  async remove(
    @Param('id', id) brandId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.brands.remove(brandId, actor.id);
  }
}

@ApiTags('catalog')
@ApiBearerAuth()
@RequirePermissions('catalog.view')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Search products (?q, categoryId incl. subcategories, brandId, type, isActive, lowStock, inStock, sort, page)',
  })
  list(
    @Query(zod(listProductsSchema)) query: ListProductsQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.list(query, canViewCost(user));
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Scan lookup: exact barcode, SKU or serial number' })
  lookup(
    @Query(zod(lookupSchema)) query: { code: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.lookup(query.code, canViewCost(user));
  }

  @Get(':id')
  get(@Param('id', id) productId: string, @CurrentUser() user: AuthUser) {
    return this.products.get(productId, canViewCost(user));
  }

  @Post()
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary: 'Create a product (stock comes in through stock documents)',
  })
  @ApiZodBody(createProductSchema)
  create(
    @Body(zod(createProductSchema)) body: CreateProductInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.create(body, user.id, canViewCost(user));
  }

  @Patch(':id')
  @RequirePermissions('product.manage')
  @ApiZodBody(updateProductSchema)
  update(
    @Param('id', id) productId: string,
    @Body(zod(updateProductSchema)) body: UpdateProductInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.update(productId, body, user.id, canViewCost(user));
  }

  @Post('bulk-price')
  @HttpCode(200)
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary: 'Raise/lower prices by a percentage for many products',
  })
  @ApiZodBody(bulkPriceSchema)
  bulkPrice(
    @Body(zod(bulkPriceSchema)) body: BulkPriceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.bulkPrice(body, user.id);
  }

  @Put('prices')
  @RequirePermissions('product.manage')
  @ApiOperation({ summary: 'Set explicit prices for many products' })
  @ApiZodBody(setPricesSchema)
  setPrices(
    @Body(zod(setPricesSchema)) body: SetPricesInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.setPrices(body, user.id);
  }

  @Post(':id/images')
  @RequirePermissions('product.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a JPEG/PNG/WebP image (≤ 5 MB) as form field "file"',
  })
  addImage(
    @Param('id', id) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file)
      throw new BadRequestException('Send the image as form field "file"');
    return this.products.addImage(productId, file);
  }

  @Put(':id/images/order')
  @RequirePermissions('product.manage')
  @ApiZodBody(reorderImagesSchema)
  reorderImages(
    @Param('id', id) productId: string,
    @Body(zod(reorderImagesSchema)) body: { imageIds: string[] },
  ) {
    return this.products.reorderImages(productId, body.imageIds);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(204)
  @RequirePermissions('product.manage')
  async removeImage(
    @Param('id', id) productId: string,
    @Param('imageId', id) imageId: string,
  ) {
    await this.products.removeImage(productId, imageId);
  }
}
