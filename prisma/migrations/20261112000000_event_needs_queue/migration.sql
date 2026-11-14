-- AlterTable: some events do not need a queue (publishing them opens no queue date)
ALTER TABLE "events" ADD COLUMN "needsQueue" BOOLEAN NOT NULL DEFAULT true;
