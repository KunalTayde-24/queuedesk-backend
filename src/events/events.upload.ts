import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_IMAGE_BYTES } from './events.image';

export const eventImageUpload = FileInterceptor('image', {
  limits: { fileSize: MAX_IMAGE_BYTES },
});
