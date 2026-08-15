import { prisma } from '@aishorts/shared';
import { resolveCardImage } from './media';

// Backfill self-hosted images for existing cards. Targets cards whose imageUrl is
// missing or still points at an external host (e.g. old picsum/RSS URLs), and
// replaces it with a Pexels download (or a bundled placeholder). Safe to re-run;
// cards already on /media are skipped.
//
//   npm run -w @aishorts/worker backfill:media
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cards = await prisma.card.findMany({
    where: {
      OR: [{ imageUrl: null }, { NOT: { imageUrl: { startsWith: '/media/' } } }],
    },
    select: { id: true, title: true, category: true, tags: true, imageUrl: true },
  });

  console.log(`Backfilling media for ${cards.length} card(s)...`);
  let updated = 0;
  for (const c of cards) {
    const imageUrl = await resolveCardImage({
      title: c.title,
      category: c.category,
      tags: c.tags,
      existing: c.imageUrl,
    });
    if (imageUrl !== c.imageUrl) {
      await prisma.card.update({ where: { id: c.id }, data: { imageUrl } });
      updated++;
      console.log(`  + ${c.category}: ${c.title.slice(0, 60)} -> ${imageUrl}`);
    }
    await sleep(400); // stay under Pexels' rate limit
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
