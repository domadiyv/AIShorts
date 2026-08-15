import path from 'node:path';
import fs from 'node:fs';

// Where self-hosted card images live on disk. The worker downloads images here
// and the API serves them at MEDIA_ROUTE. Anchored to this module's own location
// (packages/shared/dist -> repo root) so it resolves to the SAME absolute path
// no matter which service imports it or what its cwd is. Override with MEDIA_DIR
// (e.g. an absolute path to a mounted volume).
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Absolute path to the media directory (created if missing). */
export function mediaDir(): string {
  const dir = process.env.MEDIA_DIR
    ? path.resolve(process.env.MEDIA_DIR)
    : path.join(REPO_ROOT, 'services', 'api', 'media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** URL path prefix the API serves media under. Stored imageUrls are relative. */
export const MEDIA_ROUTE = '/media';

/** Absolute path for a media file by name (no path traversal). */
export function mediaPathFor(filename: string): string {
  return path.join(mediaDir(), path.basename(filename));
}

/** The relative URL for a stored media file, e.g. `/media/abc.jpg`. */
export function mediaUrlFor(filename: string): string {
  return `${MEDIA_ROUTE}/${path.basename(filename)}`;
}

/**
 * Copy bundled seed placeholders into the media dir's `seed/` subfolder if they
 * aren't already there. Needed because in Docker the media dir is a named volume
 * that hides the image's baked-in files, and a volume is only initialised from
 * the image on FIRST creation — so an existing volume won't have new seed images.
 * The Dockerfile stages the placeholders at MEDIA_SEED_DIR (outside the volume);
 * call this at API startup. In local dev the source and dest are the same folder,
 * so it's a no-op. Safe and idempotent.
 */
export function ensureSeedMedia(): void {
  const src = process.env.MEDIA_SEED_DIR;
  if (!src || !fs.existsSync(src)) return;
  const destDir = path.join(mediaDir(), 'seed');
  if (path.resolve(src) === path.resolve(destDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const to = path.join(destDir, f);
    if (!fs.existsSync(to)) fs.copyFileSync(path.join(src, f), to);
  }
}
