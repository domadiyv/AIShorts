// Generate bundled, license-free card placeholder images (one per category + a
// default). These are self-generated gradients — no third-party assets — so a
// card always has something to show, even fully offline in the container.
//
//   node scripts/gen-placeholders.mjs
//
// Output: services/api/media/seed/<category>.png  (+ default.png), 800x450.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'services', 'api', 'media', 'seed');
fs.mkdirSync(OUT, { recursive: true });

// [category label, top color, bottom color]
const TILES = [
  ['Models', '#2563eb', '#1e3a8a'],
  ['Tools', '#0d9488', '#134e4a'],
  ['Research', '#7c3aed', '#4c1d95'],
  ['Business', '#b45309', '#7c2d12'],
  ['Policy', '#b91c1c', '#7f1d1d'],
  ['How-to', '#15803d', '#14532d'],
  ['AIShorts', '#334155', '#0f172a'], // default.png
];

const W = 800;
const H = 450;

function svg(label, top, bottom) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="100%" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="50%" y="47%" text-anchor="middle" fill="#ffffff"
        font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="700">${label}</text>
  <text x="50%" y="62%" text-anchor="middle" fill="#ffffff" opacity="0.7"
        font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="3">AISHORTS</text>
</svg>`;
}

for (const [label, top, bottom] of TILES) {
  const slug = label === 'AIShorts' ? 'default' : label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const file = path.join(OUT, `${slug}.png`);
  await sharp(Buffer.from(svg(label, top, bottom))).png().toFile(file);
  console.log(`  + ${path.relative(ROOT, file)}`);
}
console.log('Done generating placeholders.');
