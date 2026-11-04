import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ImageStoreService, MAX_IMAGE_BYTES } from './image-store.service.js';
import { ApiZodResponse, apiSchema } from './openapi.js';
import { hasPermission } from './permissions.js';

export const uploadedImageSchema = apiSchema(
  'UploadedImage',
  z.object({ url: z.string() }),
);

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly images: ImageStoreService) {}

  /** Logos (company, brands): the client stores the returned URL with a normal update. */
  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Upload a logo (JPEG/PNG/WebP ≤ 5 MB, form field "file"); needs settings.manage or product.manage',
  })
  @ApiZodResponse(uploadedImageSchema, { status: 201 })
  async logo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (
      !hasPermission(user.permissions, 'settings.manage') &&
      !hasPermission(user.permissions, 'product.manage')
    )
      throw new ForbiddenException();
    if (!file)
      throw new BadRequestException('Send the image as form field "file"');
    return { url: await this.images.save('branding', file) };
  }
}
