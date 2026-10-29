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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ApiZodResponse } from '../common/openapi.js';
import { queryBoolean } from '../common/pagination.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  createBranchSchema,
  updateBranchSchema,
  type CreateBranchInput,
  type UpdateBranchInput,
} from './branches.schemas.js';
import { branchesSchema, branchSchema } from './branches.responses.js';
import { BranchesService } from './branches.service.js';

const id = new ParseUUIDPipe();

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiZodResponse(branchesSchema)
  list(@Query('all', zod(queryBoolean.optional())) all?: boolean) {
    return this.branches.list(all);
  }

  @Get(':id')
  @ApiZodResponse(branchSchema)
  get(@Param('id', id) branchId: string) {
    return this.branches.get(branchId);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiZodBody(createBranchSchema)
  create(
    @Body(zod(createBranchSchema)) body: CreateBranchInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.branches.create(body, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  @ApiZodBody(updateBranchSchema)
  update(
    @Param('id', id) branchId: string,
    @Body(zod(updateBranchSchema)) body: UpdateBranchInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.branches.update(branchId, body, actor.id);
  }
}
