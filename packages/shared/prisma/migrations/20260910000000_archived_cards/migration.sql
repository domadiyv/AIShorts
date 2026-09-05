-- CreateTable
CREATE TABLE "archived_cards" (
    "id" TEXT NOT NULL,
    "originalCardId" TEXT NOT NULL,
    "type" "CardType" NOT NULL DEFAULT 'news',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whyItMatters" TEXT,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "imageUrl" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "CardStatus" NOT NULL DEFAULT 'published',
    "importance" INTEGER NOT NULL DEFAULT 3,
    "articlePublishedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archived_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "archived_cards_originalCardId_key" ON "archived_cards"("originalCardId");

-- CreateIndex
CREATE INDEX "archived_cards_articlePublishedAt_idx" ON "archived_cards"("articlePublishedAt");
