-- Adds the auth columns to `users`. These fields were added to the Prisma schema
-- (email/password + Google SSO login) without a matching migration, so the live
-- database still had only id/email/createdAt and every register/login/google call
-- failed with `column users.name does not exist`. This backfills the schema.
--
-- `updatedAt` is created with a DEFAULT so the ADD COLUMN succeeds even when the
-- table already has rows; Prisma's @updatedAt manages it going forward.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'password',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");
