// Simple script to generate PWA icons using sharp (if available)
// If sharp is not available, creates placeholder SVG icons

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

// Simple SVG icon template - a cute dress icon for the dress-up game
const createSvgIcon = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ff69b4;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#ff1493;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="url(#bg)"/>
  <g transform="translate(${size * 0.5}, ${size * 0.5})">
    <!-- Dress shape -->
    <path d="M0 ${-size * 0.3} 
             L${size * 0.15} ${-size * 0.15}
             L${size * 0.25} ${size * 0.3}
             L${-size * 0.25} ${size * 0.3}
             L${-size * 0.15} ${-size * 0.15}
             Z" 
          fill="white" opacity="0.9"/>
    <!-- Collar -->
    <ellipse cx="0" cy="${-size * 0.28}" rx="${size * 0.08}" ry="${size * 0.04}" fill="white"/>
    <!-- Ribbon -->
    <circle cx="0" cy="${-size * 0.18}" r="${size * 0.03}" fill="#ffb6c1"/>
  </g>
</svg>`;

// Write SVG files
const sizes = [192, 512];
sizes.forEach(size => {
  const svgContent = createSvgIcon(size);
  const filename = `pwa-${size}x${size}.svg`;
  fs.writeFileSync(path.join(publicDir, filename), svgContent);
  console.log(`Created ${filename}`);
});

// Also create a simple favicon
const faviconSvg = createSvgIcon(32);
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), faviconSvg);
console.log('Created favicon.svg');

console.log('\\nDone! SVG icons created.');
console.log('Note: For PNG icons, you can convert these SVGs using an online tool or image editor.');
