import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
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
export type ImageFolder =
  'products' | 'branding' | 'repairs' | 'expenses' | 'avatars' | 'slips';
const FOLDERS: ImageFolder[] = [
  'products',
  'branding',
  'repairs',
  'expenses',
  'avatars',
  'slips',
];
/** Platform files (bank QR codes): not owned by any company. */
const PLATFORM_DIR = 'platform';

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
    return this.write(`${folder}/${RequestContext.tenantId()}`, file);
  }

  /** Validates and stores a platform image (bank QR codes); returns its URL. */
  savePlatform(file: {
    buffer: Buffer;
    mimetype: string;
    size: number;
  }): Promise<string> {
    return this.write(PLATFORM_DIR, file);
  }

  /** True for a URL that `savePlatform()` returned. */
  isPlatform(url: string): boolean {
    const rest = url.startsWith(PREFIX) ? url.slice(PREFIX.length) : '';
    return /^platform\/[\w-]+\.(jpg|png|webp)$/.test(rest);
  }

  private async write(
    dir: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<string> {
    const ext = ALLOWED_IMAGE_TYPES[file.mimetype];
    // Check the file's own signature too: the declared type comes from the client.
    if (!ext || !hasImageSignature(file.buffer, ext)) {
      throw new BadRequestException('Only JPEG, PNG or WebP images');
    }
    if (file.size > MAX_IMAGE_BYTES)
      throw new BadRequestException('Image must be 5 MB or less');
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
   * Copies an image of company `fromTenantId` into company `toTenantId` (new file, new URL),
   * for a store created as a copy of another. Outside links and unknown files give null.
   */
  async copyToTenant(
    url: string | null | undefined,
    fromTenantId: string,
    toTenantId: string,
  ): Promise<string | null> {
    if (!url?.startsWith(PREFIX)) return null;
    const [folder, tenantId, name, ...rest] = url
      .slice(PREFIX.length)
      .split('/');
    if (
      !FOLDERS.includes(folder as ImageFolder) ||
      tenantId !== fromTenantId ||
      !name ||
      rest.length ||
      !/^[\w-]+\.(jpg|png|webp)$/.test(name)
    )
      return null;
    const ext = name.split('.').pop()!;
    const dir = `${folder}/${toTenantId}`;
    const copy = `${randomUUID()}.${ext}`;
    try {
      await mkdir(path.join(this.root(), dir), { recursive: true });
      await copyFile(
        path.join(this.root(), folder, tenantId, name),
        path.join(this.root(), dir, copy),
      );
    } catch {
      return null;
    }
    return `${PREFIX}${dir}/${copy}`;
  }

  /** Removes every file of a company (a store whose creation failed half way). */
  async removeTenantFiles(tenantId: string): Promise<void> {
    if (!/^[\w-]+$/.test(tenantId)) return;
    await Promise.all(
      FOLDERS.map((f) =>
        rm(path.join(this.root(), f, tenantId), {
          recursive: true,
          force: true,
        }),
      ),
    );
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
