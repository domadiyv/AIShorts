// Generate the self-hosted SAMPLE IMAGE LIBRARY — license-free, offline,
// no third-party assets. These abstract themed tiles are committed as PNGs and
// loaded into Postgres (media_assets, kind='sample') by the seed, then chosen on
// the fly by the worker when a card has no source image. No image library is
// needed at runtime or in Docker — only here, at authoring time.
//
//   node scripts/gen-sample-images.mjs
//
// Output: packages/shared/prisma/sample-images/<category-slug>-<n>.png (800x450)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'packages', 'shared', 'prisma', 'sample-images');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const W = 800;
const H = 450;

// A few complementary palettes per category → several distinct-looking tiles so
// cards in the same category don't all share one image. [top, bottom, accent].
const PALETTES = {
  Models: [
    ['#1d4ed8', '#0b1e52', '#60a5fa'],
    ['#2563eb', '#1e3a8a', '#93c5fd'],
    ['#4338ca', '#1e1b4b', '#818cf8'],
    ['#0ea5e9', '#0c4a6e', '#7dd3fc'],
  ],
  Tools: [
    ['#0d9488', '#134e4a', '#5eead4'],
    ['#059669', '#064e3b', '#6ee7b7'],
    ['#0891b2', '#164e63', '#67e8f9'],
    ['#14b8a6', '#0f766e', '#99f6e4'],
  ],
  Research: [
    ['#7c3aed', '#3b0764', '#c4b5fd'],
    ['#9333ea', '#4c1d95', '#d8b4fe'],
    ['#6d28d9', '#2e1065', '#a78bfa'],
    ['#a21caf', '#4a044e', '#f0abfc'],
  ],
  Business: [
    ['#b45309', '#7c2d12', '#fbbf24'],
    ['#d97706', '#78350f', '#fcd34d'],
    ['#ea580c', '#7c2d12', '#fdba74'],
    ['#ca8a04', '#713f12', '#fde047'],
  ],
  Policy: [
    ['#b91c1c', '#7f1d1d', '#fca5a5'],
    ['#dc2626', '#7f1d1d', '#f87171'],
    ['#be123c', '#4c0519', '#fda4af'],
    ['#e11d48', '#881337', '#fecdd3'],
  ],
  'How-to': [
    ['#15803d', '#14532d', '#86efac'],
    ['#16a34a', '#166534', '#4ade80'],
    ['#65a30d', '#365314', '#bef264'],
    ['#0f766e', '#134e4a', '#5eead4'],
  ],
  // Generic fallback tiles for any category without its own palette.
  General: [
    ['#334155', '#0f172a', '#94a3b8'],
    ['#475569', '#1e293b', '#cbd5e1'],
    ['#3f3f46', '#18181b', '#a1a1aa'],
    ['#1e293b', '#020617', '#64748b'],
  ],
};

// Deterministic per-tile decorations so output is stable across runs.
function shapes(accent, variant) {
  const layouts = [
    // rings
    `<circle cx="640" cy="110" r="150" fill="none" stroke="${accent}" stroke-width="18" opacity="0.30"/>
     <circle cx="640" cy="110" r="90" fill="none" stroke="${accent}" stroke-width="12" opacity="0.22"/>`,
    // diagonal bars
    `<g opacity="0.22" fill="${accent}">
       <rect x="520" y="-40" width="46" height="560" transform="rotate(20 540 240)"/>
       <rect x="610" y="-40" width="46" height="560" transform="rotate(20 630 240)"/>
       <rect x="700" y="-40" width="46" height="560" transform="rotate(20 720 240)"/>
     </g>`,
    // dot grid
    (() => {
      let d = '<g opacity="0.28" fill="' + accent + '">';
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 6; c++)
          d += `<circle cx="${470 + c * 58}" cy="${70 + r * 70}" r="10"/>`;
      return d + '</g>';
    })(),
    // triangles
    `<g opacity="0.24" fill="${accent}">
       <polygon points="560,360 660,180 760,360"/>
       <polygon points="470,360 545,240 620,360"/>
     </g>`,
  ];
  return layouts[variant % layouts.length];
}

function svg(label, [top, bottom, accent], variant) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="100%" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  ${shapes(accent, variant)}
  <text x="48" y="${H - 96}" fill="#ffffff" opacity="0.96"
        font-family="Helvetica, Arial, sans-serif" font-size="52" font-weight="800">${label}</text>
  <text x="50" y="${H - 52}" fill="#ffffff" opacity="0.6"
        font-family="Helvetica, Arial, sans-serif" font-size="20" letter-spacing="4">AISHORTS</text>
</svg>`;
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

let n = 0;
for (const [label, palettes] of Object.entries(PALETTES)) {
  for (let v = 0; v < palettes.length; v++) {
    const file = path.join(OUT, `${slugify(label)}-${v + 1}.png`);
    await sharp(Buffer.from(svg(label, palettes[v], v))).png().toFile(file);
    n++;
  }
}
console.log(`Generated ${n} sample images into ${path.relative(ROOT, OUT)}`);
