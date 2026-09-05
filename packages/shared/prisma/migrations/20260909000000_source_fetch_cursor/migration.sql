-- Per-source high-water mark: newest item publish date ingested so far.
-- Additive + nullable, so existing rows default to NULL (first run ingests
-- normally, then records the cursor).
ALTER TABLE "sources" ADD COLUMN "lastItemAt" TIMESTAMP(3);
