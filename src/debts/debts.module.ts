import { Module } from '@nestjs/common';
import { DebtsController } from './debts.controller.js';
import { DebtsService } from './debts.service.js';

@Module({ controllers: [DebtsController], providers: [DebtsService] })
export class DebtsModule {}
