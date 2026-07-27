import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sizes = [16, 32, 48, 128];
const source = path.resolve('public/icon/source.svg');
const outputDirectory = path.resolve('public/icon');

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  sizes.map((size) =>
    sharp(source)
      .resize(size, size)
      .png()
      .toFile(path.join(outputDirectory, `${size}.png`)),
  ),
);
