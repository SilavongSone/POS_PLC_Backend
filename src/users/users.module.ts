import { Module } from '@nestjs/common';
import { UserGroupsService } from './user-groups.service.js';
import { UserGroupsController, UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController, UserGroupsController],
  providers: [UsersService, UserGroupsService],
})
export class UsersModule {}
