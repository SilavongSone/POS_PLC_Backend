import { Global, Module } from '@nestjs/common';
import { BranchAccessService } from './branch-access.service.js';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';

@Global()
@Module({
  controllers: [BranchesController],
  providers: [BranchesService, BranchAccessService],
  exports: [BranchAccessService],
})
export class BranchesModule {}
