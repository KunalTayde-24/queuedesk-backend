-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'QUEUE');

-- AlterTable: existing accounts stay full admins
ALTER TABLE "admins" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'ADMIN';
