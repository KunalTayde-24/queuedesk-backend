-- AlterTable: when a token was last called (several tokens can be CALLED at once)
ALTER TABLE "tokens" ADD COLUMN "calledAt" TIMESTAMP(3);
