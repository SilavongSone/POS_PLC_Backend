import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service.js';
import {
  BrandsController,
  CategoriesController,
  ProductsController,
  UnitsController,
} from './catalog.controller.js';
import { UnitsService } from './units.service.js';
import { CategoriesService } from './categories.service.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [
    CategoriesController,
    BrandsController,
    UnitsController,
    ProductsController,
  ],
  providers: [CategoriesService, BrandsService, UnitsService, ProductsService],
  exports: [ProductsService, CategoriesService],
})
export class CatalogModule {}
