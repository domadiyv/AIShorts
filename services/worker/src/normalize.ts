import { prisma } from '@aishorts/shared';
import { trimSummary } from './summarize';

// One-off: bring existing card summaries into the <=62 word promise.
async function main() {
  const cards = await prisma.card.findMany({ select: { id: true, summary: true } });
  let changed = 0;
  for (const c of cards) {
    const trimmed = trimSummary(c.summary);
    if (trimmed !== c.summary) {
      await prisma.card.update({ where: { id: c.id }, data: { summary: trimmed } });
      changed++;
    }
  }
  console.log(`Normalized ${changed}/${cards.length} summaries to <=62 words.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
