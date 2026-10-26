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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { UserGroupsService } from './user-groups.service.js';
import {
  createGroupSchema,
  createUserSchema,
  listUsersSchema,
  resetPasswordSchema,
  setPinSchema,
  updateGroupSchema,
  updateUserSchema,
  type CreateGroupInput,
  type CreateUserInput,
  type ListUsersQuery,
  type ResetPasswordInput,
  type SetPinInput,
  type UpdateGroupInput,
  type UpdateUserInput,
} from './users.schemas.js';
import { UsersService } from './users.service.js';

const id = new ParseUUIDPipe();

@ApiTags('users')
@ApiBearerAuth()
@RequirePermissions('users.manage')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users (?q, groupId, isActive, page, pageSize)',
  })
  list(@Query(zod(listUsersSchema)) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  get(@Param('id', id) userId: string) {
    return this.users.get(userId);
  }

  @Post()
  @ApiZodBody(createUserSchema)
  create(
    @Body(zod(createUserSchema)) body: CreateUserInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.create(body, actor.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update name, group or active flag (deactivating signs the user out)',
  })
  @ApiZodBody(updateUserSchema)
  update(
    @Param('id', id) userId: string,
    @Body(zod(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.update(userId, body, actor.id);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  @ApiZodBody(resetPasswordSchema)
  async resetPassword(
    @Param('id', id) userId: string,
    @Body(zod(resetPasswordSchema)) body: ResetPasswordInput,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.users.resetPassword(userId, body.newPassword, actor.id);
  }

  @Put(':id/pin')
  @HttpCode(204)
  @ApiZodBody(setPinSchema)
  async setPin(
    @Param('id', id) userId: string,
    @Body(zod(setPinSchema)) body: SetPinInput,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.users.setPin(userId, body.pin, actor.id);
  }

  @Delete(':id/pin')
  @HttpCode(204)
  async clearPin(
    @Param('id', id) userId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.users.setPin(userId, null, actor.id);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Clear a login lock after too many failed attempts',
  })
  unlock(@Param('id', id) userId: string, @CurrentUser() actor: AuthUser) {
    return this.users.unlock(userId, actor.id);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@RequirePermissions('users.manage')
@Controller('user-groups')
export class UserGroupsController {
  constructor(private readonly groups: UserGroupsService) {}

  @Get()
  list() {
    return this.groups.list();
  }

  @Get('permissions')
  @ApiOperation({
    summary: 'All permission codes that can be granted ("*" = everything)',
  })
  permissions() {
    return ['*', ...PERMISSIONS];
  }

  @Post()
  @ApiZodBody(createGroupSchema)
  create(
    @Body(zod(createGroupSchema)) body: CreateGroupInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groups.create(body, actor.id);
  }

  @Patch(':id')
  @ApiZodBody(updateGroupSchema)
  update(
    @Param('id', id) groupId: string,
    @Body(zod(updateGroupSchema)) body: UpdateGroupInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groups.update(groupId, body, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', id) groupId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.groups.remove(groupId, actor.id);
  }
}
