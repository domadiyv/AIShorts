import { prisma } from '@aishorts/shared';

// Quick DB sanity check: counts by table + per-source + card status breakdown.
async function main() {
  console.log('sources   :', await prisma.source.count());
  console.log('raw_items :', await prisma.rawItem.count());
  console.log('cards     :', await prisma.card.count());

  const bySource = await prisma.source.findMany({
    select: { name: true, _count: { select: { rawItems: true } } },
  });
  for (const s of bySource) console.log('   -', s.name, s._count.rawItems);

  const pending = await prisma.card.count({ where: { status: 'pending' } });
  const published = await prisma.card.count({ where: { status: 'published' } });
  console.log('cards pending/published:', pending, '/', published);

  const samples = await prisma.card.findMany({
    where: { sourceName: { in: ['TechCrunch AI', 'The Verge AI', 'VentureBeat AI'] } },
    orderBy: { createdAt: 'asc' },
    take: 4,
  });
  for (const c of samples) {
    const words = c.summary.trim().split(/\s+/).length;
    console.log('\n----------------------------------------');
    console.log(`[${c.difficulty} | ${c.category}] ${c.title}`);
    console.log(c.summary, `(${words} words)`);
    if (c.whyItMatters) console.log('Why:', c.whyItMatters);
    console.log('Source:', c.sourceName, '—', c.sourceUrl);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
