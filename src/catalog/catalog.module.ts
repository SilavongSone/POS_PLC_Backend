import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service.js';
import {
  BrandsController,
  CategoriesController,
  ProductsController,
} from './catalog.controller.js';
import { CategoriesService } from './categories.service.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [CategoriesController, BrandsController, ProductsController],
  providers: [CategoriesService, BrandsService, ProductsService],
  exports: [ProductsService, CategoriesService],
})
export class CatalogModule {}
