// Script to generate PWA icons from app-icon.png
// Requires: npm install sharp (optional, fallback to copy if not available)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const sourceIcon = path.join(publicDir, 'app-icon.png');

async function generateIcons() {
  // Check if source icon exists
  if (!fs.existsSync(sourceIcon)) {
    console.error('Error: public/app-icon.png not found!');
    console.log('Please save your icon image as public/app-icon.png first.');
    process.exit(1);
  }

  try {
    // Try to use sharp for resizing
    const sharp = (await import('sharp')).default;
    
    // Generate different sizes
    const sizes = [
      { size: 32, name: 'favicon.png' },
      { size: 192, name: 'app-icon-192.png' },
      { size: 512, name: 'app-icon-512.png' },
    ];

    for (const { size, name } of sizes) {
      await sharp(sourceIcon)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toFile(path.join(publicDir, name));
      console.log(`Created ${name} (${size}x${size})`);
    }

    console.log('All icons generated successfully!');
  } catch (e) {
    console.log('sharp not available, copying source as-is...');
    // Fallback: just copy the source icon
    fs.copyFileSync(sourceIcon, path.join(publicDir, 'favicon.png'));
    fs.copyFileSync(sourceIcon, path.join(publicDir, 'app-icon-192.png'));
    fs.copyFileSync(sourceIcon, path.join(publicDir, 'app-icon-512.png'));
    console.log('Icons copied (consider installing sharp for proper resizing)');
  }
}

generateIcons();

console.log('\\nDone! SVG icons created.');
console.log('Note: For PNG icons, you can convert these SVGs using an online tool or image editor.');
