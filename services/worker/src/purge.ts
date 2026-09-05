import { prisma } from '@aishorts/shared';

// Purge cards whose ORIGINAL article is older than the retention window: copy each
// into `archived_cards` (a cold, text-only record) and then delete the live card
// plus its per-card image bytes to reclaim storage.
//
// What survives: the archived row keeps every text field + the ORIGINAL image URL
// (so the picture can be re-fetched manually later), but NOT the image bytes.
// Shared "sample" library images are never touched. The article's RawItem stays
// (it's the dedup record — deleting it would let the same article re-ingest).
//
//   npm run -w @aishorts/worker purge:old          # dry run (default, safe)
//   npm run -w @aishorts/worker purge:old -- --yes # actually archive + delete
//
// Tune the window with PURGE_AGE_DAYS (default 60).
const PURGE_AGE_DAYS = Number(process.env.PURGE_AGE_DAYS ?? 60);
const BATCH = 200;

// The core routine, exported so both the CLI (below) and the daily scheduler
// (scheduler.ts) can call it. `apply=false` is a dry run that changes nothing.
export async function runPurge(apply: boolean) {
  const cutoff = new Date(Date.now() - PURGE_AGE_DAYS * 86_400_000);

  // Only cards with a known article date older than the cutoff. Cards with no
  // articlePublishedAt can't be aged by "published date", so we leave them alone.
  const targets = await prisma.card.findMany({
    where: { articlePublishedAt: { not: null, lt: cutoff } },
    select: {
      id: true,
      type: true,
      title: true,
      summary: true,
      whyItMatters: true,
      category: true,
      tags: true,
      imageUrl: true,
      imageAssetId: true,
      sourceName: true,
      sourceUrl: true,
      status: true,
      importance: true,
      articlePublishedAt: true,
      publishedAt: true,
      createdAt: true,
      imageAsset: { select: { id: true, kind: true, sourceUrl: true, byteSize: true } },
    },
    orderBy: { articlePublishedAt: 'asc' },
  });

  const totalCards = await prisma.card.count();
  const byStatus = targets.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  // Reclaimable bytes = the per-card ("source") image assets we'll drop.
  const reclaimBytes = targets.reduce(
    (n, c) => n + (c.imageAsset?.kind === 'source' ? c.imageAsset.byteSize ?? 0 : 0),
    0,
  );
  const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

  console.log(`Cutoff: articles published before ${cutoff.toISOString().slice(0, 10)} (${PURGE_AGE_DAYS} days)`);
  console.log(
    `Cards total: ${totalCards} | to purge: ${targets.length}` +
      (targets.length ? ` (${Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ')})` : ''),
  );
  console.log(`Reclaimable image bytes: ~${(reclaimBytes / 1_048_576).toFixed(1)} MiB (source images only; samples kept)\n`);

  for (const c of targets.slice(0, 10)) {
    console.log(`  - [${days(c.articlePublishedAt!)}d] ${c.status.padEnd(9)} ${c.title.slice(0, 56)}`);
  }
  if (targets.length > 10) console.log(`  ... and ${targets.length - 10} more`);

  if (!targets.length) return console.log('\nNothing to do.');

  if (!apply) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --yes to archive + purge these ${targets.length} card(s).`);
    return;
  }

  let archived = 0;
  let deletedCards = 0;
  let deletedAssets = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const ids = batch.map((c) => c.id);
    // Per-card image assets to drop (never "sample" — those are shared library art).
    const sourceAssetIds = batch
      .filter((c) => c.imageAsset?.kind === 'source')
      .map((c) => c.imageAsset!.id);

    await prisma.$transaction(async (tx) => {
      // 1) Archive (skipDuplicates makes re-runs after a partial failure safe).
      const res = await tx.archivedCard.createMany({
        data: batch.map((c) => ({
          originalCardId: c.id,
          type: c.type,
          title: c.title,
          summary: c.summary,
          whyItMatters: c.whyItMatters,
          category: c.category,
          tags: c.tags,
          // Prefer the URL the source image was fetched from; fall back to the
          // card's own (legacy/relative) URL. This is what lets us re-fetch later.
          imageUrl: c.imageAsset?.sourceUrl ?? c.imageUrl ?? null,
          sourceName: c.sourceName,
          sourceUrl: c.sourceUrl,
          status: c.status,
          importance: c.importance,
          articlePublishedAt: c.articlePublishedAt,
          publishedAt: c.publishedAt,
          createdAt: c.createdAt,
        })),
        skipDuplicates: true,
      });
      archived += res.count;

      // 2) Remove child rows that FK to the card, then the cards themselves.
      await tx.bookmark.deleteMany({ where: { cardId: { in: ids } } });
      await tx.cardEvent.deleteMany({ where: { cardId: { in: ids } } });
      const delCards = await tx.card.deleteMany({ where: { id: { in: ids } } });
      deletedCards += delCards.count;

      // 3) Drop the freed per-card image bytes — but only assets no remaining card
      //    references (guards against a shared asset), and only "source" kind.
      if (sourceAssetIds.length) {
        const delAssets = await tx.mediaAsset.deleteMany({
          where: { id: { in: sourceAssetIds }, kind: 'source', cards: { none: {} } },
        });
        deletedAssets += delAssets.count;
      }
    });

    console.log(`  batch ${i / BATCH + 1}: archived+purged ${batch.length} card(s)`);
  }

  console.log(
    `\nDone — archived ${archived}, deleted ${deletedCards} card(s), freed ${deletedAssets} source image(s).`,
  );
}

// CLI wrapper: dry run by default, `--yes` to apply. Skipped when imported
// (e.g. by the scheduler), which calls runPurge() directly.
const invokedDirectly = process.argv[1]?.endsWith('purge.ts');
if (invokedDirectly) {
  runPurge(process.argv.includes('--yes'))
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
