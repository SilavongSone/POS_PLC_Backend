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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import {
  ApiErrors,
  ApiZodResponse,
  errors,
  PERMISSION,
  SIGNED_IN,
  VALIDATION,
} from '../common/openapi.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  labelTemplateSchema,
  labelTemplatesSchema,
} from './catalog.responses.js';
import {
  createLabelTemplateSchema,
  updateLabelTemplateSchema,
  type CreateLabelTemplateInput,
  type UpdateLabelTemplateInput,
} from './label-templates.schemas.js';
import { LabelTemplatesService } from './label-templates.service.js';

const id = new ParseUUIDPipe();

@ApiTags('catalog')
@ApiBearerAuth()
@RequirePermissions('catalog.view')
@Controller('label-templates')
export class LabelTemplatesController {
  constructor(private readonly templates: LabelTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Barcode label layouts (default first)' })
  @ApiZodResponse(labelTemplatesSchema)
  @ApiErrors(errors(VALIDATION, SIGNED_IN, PERMISSION))
  list() {
    return this.templates.list();
  }

  @Post()
  @RequirePermissions('product.manage')
  @ApiZodBody(createLabelTemplateSchema)
  @ApiZodResponse(labelTemplateSchema)
  create(
    @Body(zod(createLabelTemplateSchema)) body: CreateLabelTemplateInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.templates.create(body, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('product.manage')
  @ApiZodBody(updateLabelTemplateSchema)
  @ApiZodResponse(labelTemplateSchema)
  update(
    @Param('id', id) templateId: string,
    @Body(zod(updateLabelTemplateSchema)) body: UpdateLabelTemplateInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.templates.update(templateId, body, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('product.manage')
  async remove(
    @Param('id', id) templateId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.templates.remove(templateId, actor.id);
  }
}
