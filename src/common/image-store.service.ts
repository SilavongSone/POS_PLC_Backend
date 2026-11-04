import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { RequestContext } from './request-context.js';

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Folders under UPLOAD_DIR; each holds one sub-folder per company. */
export type ImageFolder = 'products' | 'branding' | 'repairs' | 'expenses';
const FOLDERS: ImageFolder[] = ['products', 'branding', 'repairs', 'expenses'];

const PREFIX = '/api/uploads/';

/** Magic bytes of the allowed image formats. */
function hasImageSignature(buf: Buffer, ext: string): boolean {
  if (ext === 'jpg')
    return buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (ext === 'png')
    return buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (ext === 'webp') {
    return (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

/**
 * Uploaded images on local disk (UPLOAD_DIR, served at /api/uploads). The database keeps
 * only the returned URL. One folder per company, so a company's files can be exported or
 * removed together.
 */
@Injectable()
export class ImageStoreService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private root() {
    return path.resolve(this.config.get('UPLOAD_DIR', { infer: true }));
  }

  /** Validates and stores an image of the current company; returns its URL. */
  async save(
    folder: ImageFolder,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<string> {
    const ext = ALLOWED_IMAGE_TYPES[file.mimetype];
    // Check the file's own signature too: the declared type comes from the client.
    if (!ext || !hasImageSignature(file.buffer, ext)) {
      throw new BadRequestException('Only JPEG, PNG or WebP images');
    }
    if (file.size > MAX_IMAGE_BYTES)
      throw new BadRequestException('Image must be 5 MB or less');
    const dir = `${folder}/${RequestContext.tenantId()}`;
    const name = `${randomUUID()}.${ext}`;
    await mkdir(path.join(this.root(), dir), { recursive: true });
    await writeFile(path.join(this.root(), dir, name), file.buffer);
    return `${PREFIX}${dir}/${name}`;
  }

  /** True for a URL that `save()` returned for this folder and the current company. */
  isOwn(url: string, folder: ImageFolder): boolean {
    const [f, tenantId, name, ...rest] = url.startsWith(PREFIX)
      ? url.slice(PREFIX.length).split('/')
      : [];
    return (
      f === folder &&
      tenantId === RequestContext.tenantId() &&
      !!name &&
      !rest.length &&
      /^[\w-]+\.(jpg|png|webp)$/.test(name)
    );
  }

  /** Rejects URLs that were not uploaded by this company into `folder`. */
  assertOwn(urls: (string | null | undefined)[], folder: ImageFolder) {
    if (urls.some((u) => u && !this.isOwn(u, folder)))
      throw new BadRequestException({
        message: 'Upload the image first',
        code: 'IMAGE_NOT_UPLOADED',
      });
  }

  /**
   * Deletes the file behind a URL from `save()`. Ignores outside links and files of other
   * companies, so a URL typed into a settings field can never remove someone else's file.
   */
  async remove(url: string | null | undefined): Promise<void> {
    if (!url?.startsWith(PREFIX)) return;
    const [folder, tenantId] = url.slice(PREFIX.length).split('/');
    if (
      !FOLDERS.includes(folder as ImageFolder) ||
      tenantId !== RequestContext.tenantId()
    )
      return;
    const file = path.join(this.root(), url.slice(PREFIX.length));
    if (file.startsWith(this.root() + path.sep))
      await unlink(file).catch(() => undefined);
  }
}
