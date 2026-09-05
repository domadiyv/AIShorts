-- Blended feed ranking:
--   * rescale source priority to a 1..5 importance scale (1 = top … 5 = low)
--   * per-card story importance (1..5), the article's own published date, and a
--     denormalized blended rankScore used to order the feed.
-- See computeRankScore() in @aishorts/shared for the scoring formula.

-- Source importance: 1 = top … 5 = low ---------------------------------------
ALTER TABLE "sources" ALTER COLUMN "priority" SET DEFAULT 3;
UPDATE "sources" SET "priority" = 3;

-- Card ranking columns -------------------------------------------------------
ALTER TABLE "cards" ADD COLUMN "importance" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "cards" ADD COLUMN "articlePublishedAt" TIMESTAMP(3);
ALTER TABLE "cards" ADD COLUMN "rankScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill each card's article date from its raw item.
UPDATE "cards" c
SET "articlePublishedAt" = r."publishedAt"
FROM "raw_items" r
WHERE c."rawItemId" = r."id" AND r."publishedAt" IS NOT NULL;

-- Backfill the blended rankScore for every existing card:
--   12*(6-importance) + 6*(6-sourcePriority) + days-since-epoch(articleDate)
-- The age term uses absolute days since the epoch; only differences between
-- cards matter for ordering, so the shared constant cancels out.
UPDATE "cards" c
SET "rankScore" =
    12 * (6 - c."importance")
  + 6  * (6 - COALESCE((
        SELECT s."priority"
        FROM "raw_items" r
        JOIN "sources" s ON s."id" = r."sourceId"
        WHERE r."id" = c."rawItemId"
      ), 3))
  + (EXTRACT(EPOCH FROM COALESCE(c."articlePublishedAt", c."publishedAt", c."createdAt")) / 86400.0);

-- Feed ordering index.
CREATE INDEX "cards_status_rankScore_idx" ON "cards"("status", "rankScore");
