// Quick script to generate extension icon PNGs from the generated image.
// Run: node scripts/generate-icons.mjs
// Requires: sharp (npm install sharp --save-dev)

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE = join(__dirname, '..', 'public', 'icon', 'icon.svg');
const OUTPUT_DIR = join(__dirname, '..', 'public', 'icon');
const SIZES = [16, 32, 48, 128];

async function generate() {
  for (const size of SIZES) {
    await sharp(SOURCE)
      .resize(size, size)
      .png()
      .toFile(join(OUTPUT_DIR, `${size}.png`));
    console.log(`✓ Generated ${size}x${size}.png`);
  }
  console.log('Done!');
}

generate().catch(console.error);
