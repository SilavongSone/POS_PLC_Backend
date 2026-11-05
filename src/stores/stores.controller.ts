import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { authTokensSchema } from '../auth/auth.responses.js';
import { AuthService } from '../auth/auth.service.js';
import type { AuthTokens, AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import {
  ApiErrors,
  ApiZodResponse,
  errors,
  VALIDATION,
} from '../common/openapi.js';
import {
  openApiSchema,
  ZodValidationPipe,
} from '../common/zod-validation.pipe.js';
import { createdStoreSchema, myStoresSchema } from './stores.responses.js';
import {
  createStoreSchema,
  switchStoreSchema,
  type CreateStoreInput,
  type SwitchStoreInput,
} from './stores.schemas.js';
import { StoresService } from './stores.service.js';

/**
 * Separate stores of one owner. Each store is its own company: no data is shared; the
 * owner's account (same confirmed e-mail) exists in each and can switch between them.
 */
@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Stores you have an account in (same confirmed e-mail)',
  })
  @ApiZodResponse(myStoresSchema)
  mine(@CurrentUser() user: AuthUser) {
    return this.auth.myStores(user.id);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary:
      'Create a separate store (new company) and copy chosen data of this one into it once',
  })
  @ApiBody({ schema: openApiSchema(createStoreSchema) })
  @ApiZodResponse(createdStoreSchema)
  @ApiErrors(
    errors(VALIDATION, {
      403: ['EMAIL_NOT_VERIFIED'],
      409: ['STORE_LIMIT_REACHED'],
    }),
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createStoreSchema)) body: CreateStoreInput,
  ) {
    return this.stores.create(user.id, body);
  }

  @Post('switch')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in to another of your stores without the password',
  })
  @ApiBody({ schema: openApiSchema(switchStoreSchema) })
  @ApiZodResponse(authTokensSchema)
  @ApiErrors(
    errors(VALIDATION, { 403: ['STORE_NOT_YOURS', 'TENANT_SUSPENDED'] }),
  )
  switch(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(switchStoreSchema)) body: SwitchStoreInput,
  ): Promise<AuthTokens> {
    return this.auth.switchStore(user.id, body.tenantCode);
  }
}
