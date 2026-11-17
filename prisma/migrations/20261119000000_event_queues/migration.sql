-- Queues belong to events: each event numbers its own queue per date.

-- Tokens: which event's queue a token is in (null = taken before queues belonged to events).
ALTER TABLE "tokens" ADD COLUMN "eventId" TEXT;

-- Queue days: one row per (date, event). The old primary key was the date alone.
ALTER TABLE "queue_days" ADD COLUMN "id" TEXT;
ALTER TABLE "queue_days" ADD COLUMN "eventId" TEXT;
UPDATE "queue_days" SET "id" = gen_random_uuid()::text;
ALTER TABLE "queue_days" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "queue_days" DROP CONSTRAINT "queue_days_pkey";
ALTER TABLE "queue_days" ADD CONSTRAINT "queue_days_pkey" PRIMARY KEY ("id");

-- Backfill 1: every date that is currently open and covered by a published event with a queue
-- becomes one open row per such event (Singapore calendar days, as the app computes them).
INSERT INTO "queue_days" ("id", "date", "createdAt", "eventId")
SELECT gen_random_uuid()::text, d::date, now(), e."id"
FROM "events" e
CROSS JOIN LATERAL generate_series(
  ((e."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore')::date,
  (((e."endsAt" - interval '1 millisecond') AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore')::date,
  interval '1 day'
) AS d
WHERE e."status" = 'PUBLISHED'
  AND e."needsQueue"
  AND EXISTS (
    SELECT 1 FROM "queue_days" q WHERE q."date" = d::date AND q."eventId" IS NULL
  );

-- The old date-only rows are replaced by the per-event rows above (history-only dates stay as they are).
DELETE FROM "queue_days" q
WHERE q."eventId" IS NULL
  AND EXISTS (SELECT 1 FROM "queue_days" q2 WHERE q2."date" = q."date" AND q2."eventId" IS NOT NULL);

-- Backfill 2: a token whose date is covered by exactly one published event with a queue is
-- put in that event's queue. Anything ambiguous or without an event stays null.
UPDATE "tokens" t
SET "eventId" = m."eventId"
FROM (
  SELECT t2."id" AS "tokenId", (array_agg(e."id"))[1] AS "eventId"
  FROM "tokens" t2
  JOIN "events" e
    ON e."status" = 'PUBLISHED'
   AND e."needsQueue"
   AND ((e."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore')::date <= t2."date"
   AND (((e."endsAt" - interval '1 millisecond') AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore')::date >= t2."date"
  GROUP BY t2."id"
  HAVING count(*) = 1
) m
WHERE t."id" = m."tokenId";

-- Numbering is now per event and date.
DROP INDEX "tokens_date_tokenNumber_key";
CREATE UNIQUE INDEX "tokens_eventId_date_tokenNumber_key" ON "tokens"("eventId", "date", "tokenNumber");
CREATE INDEX "tokens_eventId_date_status_idx" ON "tokens"("eventId", "date", "status");
CREATE UNIQUE INDEX "queue_days_date_eventId_key" ON "queue_days"("date", "eventId");

ALTER TABLE "tokens" ADD CONSTRAINT "tokens_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "queue_days" ADD CONSTRAINT "queue_days_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
