import { prisma } from '@aishorts/shared';

// Delete PENDING draft cards and reset their raw items so they can be
// re-summarized (e.g. after improving the pipeline). Published cards are
// left untouched. Safe to run repeatedly.
async function main() {
  const drafts = await prisma.card.findMany({
    where: { status: 'pending' },
    select: { rawItemId: true },
  });
  const rawIds = drafts.map((d) => d.rawItemId).filter((x): x is string => !!x);

  const del = await prisma.card.deleteMany({ where: { status: 'pending' } });
  const upd = await prisma.rawItem.updateMany({
    where: { id: { in: rawIds } },
    data: { processedAt: null },
  });
  console.log(`Deleted ${del.count} pending cards, reset ${upd.count} raw items for re-summarization.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
