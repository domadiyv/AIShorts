import { prisma } from '@aishorts/shared';

// Reject PENDING cards whose source article is older than the cutoff.
//
// Why: the first ingest of a blog pulls its entire archive, and the summarizer
// used to work oldest-first — so the review queue filled up with months-old
// posts. This clears that out. Published cards are NEVER touched.
//
//   npm run -w @aishorts/worker reject:stale          # dry run (default, safe)
//   npm run -w @aishorts/worker reject:stale -- --yes # actually reject
//
// Tune the window with MAX_ARTICLE_AGE_DAYS (same variable the summarizer uses).
const MAX_ARTICLE_AGE_DAYS = Number(process.env.MAX_ARTICLE_AGE_DAYS ?? 21);

async function main() {
  const apply = process.argv.includes('--yes');
  const cutoff = new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 86_400_000);

  const pending = await prisma.card.findMany({
    where: { status: 'pending' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      rawItem: { select: { publishedAt: true } },
    },
  });

  // A card is stale if its article predates the cutoff. Cards with no article
  // date are kept — we can't prove they're old, so a human should decide.
  const stale = pending.filter((c) => {
    const published = c.rawItem?.publishedAt;
    return published != null && published < cutoff;
  });

  const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);
  console.log(`Cutoff: articles published before ${cutoff.toISOString().slice(0, 10)} (${MAX_ARTICLE_AGE_DAYS} days)`);
  console.log(`Pending cards: ${pending.length} | stale: ${stale.length} | keeping: ${pending.length - stale.length}\n`);

  for (const c of stale.slice(0, 10)) {
    console.log(`  - [${days(c.rawItem!.publishedAt!)}d old] ${c.title.slice(0, 60)}`);
  }
  if (stale.length > 10) console.log(`  ... and ${stale.length - 10} more`);

  if (!stale.length) return console.log('\nNothing to do.');

  if (!apply) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --yes to reject these ${stale.length} cards.`);
    return;
  }

  const res = await prisma.card.updateMany({
    where: { id: { in: stale.map((c) => c.id) } },
    data: { status: 'rejected' },
  });
  console.log(`\nRejected ${res.count} stale pending card(s). Published cards untouched.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
