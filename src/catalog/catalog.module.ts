import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service.js';
import {
  BrandsController,
  CategoriesController,
  ProductsController,
  UnitsController,
} from './catalog.controller.js';
import { LabelTemplatesController } from './label-templates.controller.js';
import { LabelTemplatesService } from './label-templates.service.js';
import { UnitsService } from './units.service.js';
import { CategoriesService } from './categories.service.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [
    CategoriesController,
    BrandsController,
    UnitsController,
    LabelTemplatesController,
    ProductsController,
  ],
  providers: [
    CategoriesService,
    BrandsService,
    UnitsService,
    LabelTemplatesService,
    ProductsService,
  ],
  exports: [ProductsService, CategoriesService],
})
export class CatalogModule {}
