import { prisma, imageAssetUrl } from '@aishorts/shared';
import { resolveCardImage } from './media';

// Backfill self-hosted images for existing cards. Targets cards that have no
// stored image asset yet (imageAssetId is null) and resolves one via the standard
// priority chain: fetch the article/source image into the DB, else a Pexels
// download (if enabled), else an on-the-fly sample tile. Safe to re-run; cards
// that already reference a MediaAsset are skipped.
//
//   npm run -w @aishorts/worker backfill:media
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cards = await prisma.card.findMany({
    where: { imageAssetId: null },
    select: { id: true, title: true, category: true, tags: true, imageUrl: true, sourceUrl: true },
  });

  console.log(`Backfilling media for ${cards.length} card(s)...`);
  let updated = 0;
  for (const c of cards) {
    const image = await resolveCardImage({
      category: c.category,
      tags: c.tags,
      // Prefer any image the card already references, then its article page.
      sourceUrls: [c.imageUrl, c.sourceUrl],
      seed: c.title,
    });
    if (image.imageAssetId) {
      await prisma.card.update({
        where: { id: c.id },
        data: { imageAssetId: image.imageAssetId, imageUrl: image.imageUrl },
      });
      updated++;
      console.log(`  + ${c.category}: ${c.title.slice(0, 60)} -> ${imageAssetUrl(image.imageAssetId)}`);
    }
    await sleep(400); // stay under Pexels' rate limit when the source path falls through
  }
  console.log(`Backfill: ${updated} card(s) updated.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
