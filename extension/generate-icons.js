import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sizes = [16, 32, 48, 128];
const inputPath = path.resolve('public', 'icon.svg');

async function generateIcons() {
  const inputBuffer = fs.readFileSync(inputPath);
  for (const size of sizes) {
    const outputPath = path.resolve('public', `icon-${size}.png`);
    await sharp(inputBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated ${outputPath}`);
  }
}

generateIcons().catch(console.error);
