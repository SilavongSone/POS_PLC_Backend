import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller.js';
import { PromotionsService } from './promotions.service.js';

@Module({ controllers: [PromotionsController], providers: [PromotionsService] })
export class PromotionsModule {}
