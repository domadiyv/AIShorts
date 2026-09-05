import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { slugify } from './constants';

// DB-backed image storage (Postgres bytea, table `media_assets`). Images are
// self-hosted IN the database — no external hotlink, no disk dependency — and
// served by the API at /v1/images/:id.
//
// Two kinds of asset:
//   - "sample": a reusable library tile, chosen on the fly by category when a
//     card has no source image. Seeded from the committed PNG library.
//   - "source": an image fetched from an article/feed for one specific card.

export const IMAGE_ROUTE = '/v1/images';

/** Public URL for a stored image asset, e.g. `/v1/images/<id>`. */
export function imageAssetUrl(id: string): string {
  return `${IMAGE_ROUTE}/${id}`;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// The committed sample-image library. `..` lands on packages/shared whether this
// module runs from dist/ (compiled, imported by the worker) or src/ (via tsx, by
// the seed), so one expression covers both. A couple of fallbacks keep it working
// if the layout ever shifts.
function sampleImagesDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '..', 'prisma', 'sample-images'),
    path.resolve(__dirname, '..', '..', 'prisma', 'sample-images'),
    path.resolve(process.cwd(), 'packages', 'shared', 'prisma', 'sample-images'),
  ];
  return candidates.find((d) => fs.existsSync(d)) ?? null;
}

export type SampleFile = {
  slug: string; // category slug, or 'general' for the generic tiles
  variant: string;
  buffer: Buffer;
  contentType: string;
  sha256: string;
};

/** Read the committed sample PNGs off disk (authoring-time output, in the repo). */
export function readSampleImageFiles(): SampleFile[] {
  const dir = sampleImagesDir();
  if (!dir) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => {
      const buffer = fs.readFileSync(path.join(dir, f));
      const m = f.replace(/\.png$/i, '').match(/^(.*)-(\d+)$/);
      return {
        slug: m ? m[1] : f.replace(/\.png$/i, ''),
        variant: m ? m[2] : '1',
        buffer,
        contentType: 'image/png',
        sha256: sha256(buffer),
      };
    });
}

/**
 * Load the sample-image library into `media_assets` (idempotent, dedup by hash).
 * Call from the seed so every environment has a full on-the-fly image library in
 * the DB. Returns how many new assets were inserted.
 */
export async function syncSampleAssets(prisma: PrismaClient): Promise<number> {
  const files = readSampleImageFiles();
  let inserted = 0;
  for (const f of files) {
    const exists = await prisma.mediaAsset.findUnique({ where: { sha256: f.sha256 } });
    if (exists) continue;
    await prisma.mediaAsset.create({
      data: {
        // Prisma's Bytes maps to Uint8Array; Buffer is a Uint8Array subclass but
        // its generic (Uint8Array<ArrayBufferLike>) doesn't match the expected
        // Uint8Array<ArrayBuffer>, so cast through unknown.
        data: f.buffer as unknown as Uint8Array<ArrayBuffer>,
        contentType: f.contentType,
        kind: 'sample',
        // 'general' tiles suit any category → stored with a null category.
        category: f.slug === 'general' ? null : f.slug,
        variant: f.variant,
        byteSize: f.buffer.length,
        sha256: f.sha256,
      },
    });
    inserted++;
  }
  return inserted;
}

// Small deterministic hash so the same card always gets the same sample tile
// (stable across re-runs) while different cards spread across the variants.
function pick(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

/**
 * Choose a sample image asset id for a category, on the fly. Prefers tiles for
 * that category (matched by slug), falling back to the generic set. `seed`
 * (e.g. the card title) spreads cards deterministically across the variants.
 * Returns null only if the library is empty.
 */
export async function pickSampleAssetId(
  prisma: PrismaClient,
  category: string,
  seed = '',
): Promise<string | null> {
  const slug = slugify(category);
  let rows = await prisma.mediaAsset.findMany({
    where: { kind: 'sample', category: slug },
    select: { id: true },
    orderBy: { variant: 'asc' },
  });
  if (rows.length === 0) {
    rows = await prisma.mediaAsset.findMany({
      where: { kind: 'sample', category: null },
      select: { id: true },
      orderBy: { variant: 'asc' },
    });
  }
  if (rows.length === 0) return null;
  return rows[pick(seed || slug, rows.length)].id;
}

/**
 * Store fetched image bytes as a "source" asset (dedup by content hash) and
 * return its id. Callers persist that id on the card (imageAssetId).
 */
export async function storeSourceImage(
  prisma: PrismaClient,
  buffer: Buffer,
  contentType: string,
  sourceUrl?: string | null,
): Promise<string> {
  const hash = sha256(buffer);
  const existing = await prisma.mediaAsset.findUnique({ where: { sha256: hash } });
  if (existing) return existing.id;
  const asset = await prisma.mediaAsset.create({
    data: {
      // See syncSampleAssets: Buffer → Uint8Array<ArrayBuffer> cast.
      data: buffer as unknown as Uint8Array<ArrayBuffer>,
      contentType,
      kind: 'source',
      byteSize: buffer.length,
      sha256: hash,
      sourceUrl: sourceUrl ?? null,
    },
  });
  return asset.id;
}
