import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  @Post('photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads'),
        // The extension is derived from the validated mime type, never from the
        // uploaded filename. Carrying the original extension over let a caller send
        // "evil.html" with a spoofed image content-type and have it stored — and then
        // served as HTML from this API's own origin.
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${ALLOWED_IMAGE_TYPES[file.mimetype] ?? '.bin'}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        // Note: mimetype is supplied by the client, so this is a first gate rather than
        // proof of content. It is paired with the extension mapping above so a forged
        // type can at worst store an image-extensioned file, not an executable one.
        if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
          return cb(
            new BadRequestException('الصورة يجب أن تكون jpeg أو png أو webp'),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  uploadPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('الصورة مطلوبة');
    const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return { url: `${baseUrl}/uploads/${file.filename}` };
  }
}
