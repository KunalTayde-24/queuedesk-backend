import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

export interface ProcessedImage {
  data: Buffer;
  mime: 'image/webp';
  name: string;
}

export async function processEventImage(
  file: UploadedImage | undefined,
): Promise<ProcessedImage> {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Choose an image to upload');
  }
  if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException('Image must be 2 MB or smaller');
  }
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw new BadRequestException('Image must be JPEG, PNG, or WebP');
  }

  try {
    const metadata = await sharp(file.buffer, {
      failOn: 'error',
      animated: false,
    }).metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new BadRequestException('Image must be JPEG, PNG, or WebP');
    }

    const data = await sharp(file.buffer, { failOn: 'error', animated: false })
      .rotate()
      .resize({
        width: 1600,
        height: 900,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    return {
      data,
      mime: 'image/webp',
      name: `${sanitizeImageName(file.originalname)}.webp`,
    };
  } catch (err) {
    if (err instanceof BadRequestException) {
      throw err;
    }
    throw new BadRequestException(
      'The image could not be read. Upload a JPEG, PNG, or WebP file.',
    );
  }
}

function sanitizeImageName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim() || 'event-banner';
  const cleaned = base
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || 'event-banner';
}
