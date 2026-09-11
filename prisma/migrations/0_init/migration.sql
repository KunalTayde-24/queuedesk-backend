-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('WAITING', 'CALLED', 'DONE');

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "tokenNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tokens_date_status_idx" ON "tokens"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_date_tokenNumber_key" ON "tokens"("date", "tokenNumber");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- Supabase Realtime + RLS setup for the public "display" screen and admin
-- dashboard, which read this table directly from the browser using the
-- Supabase anon key. Only SELECT is allowed for anon; all writes go through
-- the NestJS API using the privileged database connection.
ALTER TABLE "tokens" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read access to tokens"
  ON "tokens"
  FOR SELECT
  TO anon
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE "tokens";
