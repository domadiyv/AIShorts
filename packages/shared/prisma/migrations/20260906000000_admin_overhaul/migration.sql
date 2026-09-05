-- Admin overhaul:
--  * DB-backed images (media_assets, bytea) + cards.imageAssetId
--  * dynamic categories (categories)
--  * source ingest priority (sources.priority)
--  * admin operators (admin_users)
--  * remove difficulty entirely (column + enum)

-- Source ingest priority -----------------------------------------------------
ALTER TABLE "sources" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;
CREATE INDEX "sources_priority_idx" ON "sources"("priority");

-- Dynamic categories ---------------------------------------------------------
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_active_sortOrder_idx" ON "categories"("active", "sortOrder");

-- Self-hosted image bytes (Postgres bytea) -----------------------------------
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "kind" TEXT NOT NULL DEFAULT 'source',
    "category" TEXT,
    "variant" TEXT,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_assets_sha256_key" ON "media_assets"("sha256");
CREATE INDEX "media_assets_kind_category_idx" ON "media_assets"("kind", "category");

-- Admin operators ------------------------------------------------------------
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- Cards: link to a stored image, drop difficulty -----------------------------
ALTER TABLE "cards" ADD COLUMN "imageAssetId" TEXT;
ALTER TABLE "cards" ADD CONSTRAINT "cards_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "cards_difficulty_idx";
ALTER TABLE "cards" DROP COLUMN "difficulty";
DROP TYPE "Difficulty";
