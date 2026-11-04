import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Post,
  UploadedFile,
  UseInterceptors,
  applyDecorators,
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
import {
  ImageStoreService,
  MAX_IMAGE_BYTES,
  type ImageFolder,
} from './image-store.service.js';
import { ApiZodResponse, apiSchema } from './openapi.js';
import { hasPermission, type Permission } from './permissions.js';

export const uploadedImageSchema = apiSchema(
  'UploadedImage',
  z.object({ url: z.string() }),
);

/** Multipart image upload (form field "file") answering `{ url }`. */
const ImageUpload = (summary: string) =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        properties: { file: { type: 'string', format: 'binary' } },
      },
    }),
    ApiOperation({ summary }),
    ApiZodResponse(uploadedImageSchema, { status: 201 }),
  );

/**
 * Image uploads that belong to a record saved afterwards: the client stores the returned
 * URL with the record's normal create/update, which checks it is this company's upload.
 */
@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly images: ImageStoreService) {}

  private async save(
    folder: ImageFolder,
    file: Express.Multer.File | undefined,
    user: AuthUser,
    anyOf: Permission[],
  ) {
    if (!anyOf.some((p) => hasPermission(user.permissions, p)))
      throw new ForbiddenException();
    if (!file)
      throw new BadRequestException('Send the image as form field "file"');
    return { url: await this.images.save(folder, file) };
  }

  @Post('logo')
  @ImageUpload(
    'Shop or brand logo (JPEG/PNG/WebP ≤ 5 MB); needs settings.manage or product.manage',
  )
  logo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.save('branding', file, user, [
      'settings.manage',
      'product.manage',
    ]);
  }

  @Post('repair')
  @ImageUpload(
    "Photo of a repair device's condition; needs repair.receive or repair.manage",
  )
  repair(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.save('repairs', file, user, [
      'repair.receive',
      'repair.manage',
    ]);
  }

  @Post('expense')
  @ImageUpload('Photo of an expense receipt; needs expense.manage')
  expense(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.save('expenses', file, user, ['expense.manage']);
  }
}
