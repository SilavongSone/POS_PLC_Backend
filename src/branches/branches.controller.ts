import {
  Body,
  Controller,
  ForbiddenException,
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
import { ApiZodResponse } from '../common/openapi.js';
import { queryBoolean } from '../common/pagination.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  createBranchSchema,
  updateBranchSchema,
  type CreateBranchInput,
  type UpdateBranchInput,
} from './branches.schemas.js';
import {
  branchesSchema,
  branchSchema,
  branchTargetsSchema,
} from './branches.responses.js';
import { BranchAccessService } from './branch-access.service.js';
import { BranchesService } from './branches.service.js';

const id = new ParseUUIDPipe();

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly access: BranchAccessService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Branches the user may use (users assigned to some branches see only those)',
  })
  @ApiZodResponse(branchesSchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query('all', zod(queryBoolean.optional())) all?: boolean,
  ) {
    return this.branches.list(all, user.branchIds);
  }

  @Get('targets')
  @ApiOperation({
    summary: 'Every active branch (id, code, name): where stock can be sent',
  })
  @ApiZodResponse(branchTargetsSchema)
  targets() {
    return this.branches.targets();
  }

  @Get(':id')
  @ApiZodResponse(branchSchema)
  get(@Param('id', id) branchId: string, @CurrentUser() user: AuthUser) {
    this.access.assertAccess(user, branchId);
    return this.branches.get(branchId);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiZodBody(createBranchSchema)
  create(
    @Body(zod(createBranchSchema)) body: CreateBranchInput,
    @CurrentUser() actor: AuthUser,
  ) {
    // A new branch would be outside a limited user's branches.
    if (actor.branchIds)
      throw new ForbiddenException({
        message: 'Only users who can use every branch can do this',
        code: 'BRANCH_LIMITED_ACTOR',
      });
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
    this.access.assertAccess(actor, branchId);
    return this.branches.update(branchId, body, actor.id);
  }
}
