-- M27: Administration Master Data — turns free-text surveyorName/
-- workshopName/insurerName into real, admin-managed master entities
-- (Insurer/Broker/Surveyor/Workshop). Hand-written, not a raw
-- `prisma migrate diff` output, because a straight schema diff would
-- try to add the new FK columns as NOT NULL against tables that already
-- have rows — this file does it as one ordered, single-transaction
-- sequence instead: create the master tables, add the new FK columns
-- nullable, backfill every existing row from its old free-text value,
-- *then* tighten to NOT NULL and drop the old columns. Safe as one
-- migration (not a multi-deploy expand/contract) because this system
-- has no live production traffic yet — see docs/MASTERS.md's M27
-- section for the full backfill plan and the judgment call on grouping
-- distinct free-text values (case/whitespace variants of the same real
-- surveyor/workshop are not reconciled automatically).

-- ============================================================
-- 1) Create the four master tables.
-- ============================================================

CREATE TABLE "insurers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brokers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brokers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "surveyors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "linkedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surveyors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workshops" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "insurers_organizationId_name_key" ON "insurers"("organizationId", "name");
CREATE UNIQUE INDEX "brokers_organizationId_name_key" ON "brokers"("organizationId", "name");
CREATE UNIQUE INDEX "surveyors_organizationId_name_key" ON "surveyors"("organizationId", "name");
CREATE UNIQUE INDEX "workshops_organizationId_name_key" ON "workshops"("organizationId", "name");

ALTER TABLE "insurers" ADD CONSTRAINT "insurers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "surveyors" ADD CONSTRAINT "surveyors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "surveyors" ADD CONSTRAINT "surveyors_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 2) Add the new FK columns, nullable for now — the old free-text
--    columns are still present and are what step 3 backfills from.
-- ============================================================

ALTER TABLE "insurance_policies" ADD COLUMN "insurerId" TEXT;
ALTER TABLE "insurance_policies" ADD COLUMN "brokerId" TEXT;
ALTER TABLE "surveys" ADD COLUMN "surveyorId" TEXT;
ALTER TABLE "repair_jobs" ADD COLUMN "workshopId" TEXT;

-- ============================================================
-- 3) Backfill: one master row per distinct (organizationId, name)
--    pair found in the existing free-text data. Where the same name
--    appears on multiple rows with different contact/linkedUserId/
--    address values, the first non-null value wins (DISTINCT ON's
--    ordering below) — a real limitation of collapsing free text into
--    one row, flagged in docs/MASTERS.md rather than silently assumed
--    perfect. Distinct spellings/casing of the same real-world entity
--    are NOT reconciled (e.g. "ICICI Lombard" vs "Icici Lombard" would
--    become two Insurer rows) — out of scope for an automated backfill;
--    a human fixes real duplicates via the new Master Data admin UI
--    after this migration runs.
-- ============================================================

INSERT INTO "insurers" ("id", "organizationId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."organizationId", t."insurerName", now(), now()
FROM (
  SELECT DISTINCT "organizationId", "insurerName"
  FROM "insurance_policies"
) t;

INSERT INTO "surveyors" ("id", "organizationId", "name", "contact", "linkedUserId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."organizationId", t."surveyorName", t."surveyorContact", t."surveyorUserId", now(), now()
FROM (
  SELECT DISTINCT ON ("organizationId", "surveyorName")
    "organizationId", "surveyorName", "surveyorContact", "surveyorUserId"
  FROM "surveys"
  ORDER BY "organizationId", "surveyorName", ("surveyorContact" IS NULL), ("surveyorUserId" IS NULL)
) t;

INSERT INTO "workshops" ("id", "organizationId", "name", "contact", "address", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."organizationId", t."workshopName", t."workshopContact", t."workshopAddress", now(), now()
FROM (
  SELECT DISTINCT ON ("organizationId", "workshopName")
    "organizationId", "workshopName", "workshopContact", "workshopAddress"
  FROM "repair_jobs"
  ORDER BY "organizationId", "workshopName", ("workshopContact" IS NULL), ("workshopAddress" IS NULL)
) t;

UPDATE "insurance_policies" ip
SET "insurerId" = i."id"
FROM "insurers" i
WHERE i."organizationId" = ip."organizationId" AND i."name" = ip."insurerName";

UPDATE "surveys" s
SET "surveyorId" = sv."id"
FROM "surveyors" sv
WHERE sv."organizationId" = s."organizationId" AND sv."name" = s."surveyorName";

UPDATE "repair_jobs" rj
SET "workshopId" = w."id"
FROM "workshops" w
WHERE w."organizationId" = rj."organizationId" AND w."name" = rj."workshopName";

-- ============================================================
-- 4) Every row now has its FK populated (guaranteed — every free-text
--    value that existed produced exactly one master row above) — safe
--    to tighten to NOT NULL. brokerId stays nullable: it's genuinely
--    new, not every policy has one.
-- ============================================================

ALTER TABLE "insurance_policies" ALTER COLUMN "insurerId" SET NOT NULL;
ALTER TABLE "surveys" ALTER COLUMN "surveyorId" SET NOT NULL;
ALTER TABLE "repair_jobs" ALTER COLUMN "workshopId" SET NOT NULL;

-- ============================================================
-- 5) Drop the old free-text columns (and the FK they carried) — hard
--    cutover, not a soft transition. All future writes go through
--    master data.
-- ============================================================

ALTER TABLE "surveys" DROP CONSTRAINT "surveys_surveyorUserId_fkey";

ALTER TABLE "insurance_policies" DROP COLUMN "insurerName";
ALTER TABLE "surveys" DROP COLUMN "surveyorName";
ALTER TABLE "surveys" DROP COLUMN "surveyorContact";
ALTER TABLE "surveys" DROP COLUMN "surveyorUserId";
ALTER TABLE "repair_jobs" DROP COLUMN "workshopName";
ALTER TABLE "repair_jobs" DROP COLUMN "workshopContact";
ALTER TABLE "repair_jobs" DROP COLUMN "workshopAddress";

-- ============================================================
-- 6) Indexes + remaining foreign keys on the now-populated,
--    now-required columns.
-- ============================================================

CREATE INDEX "surveys_surveyorId_idx" ON "surveys"("surveyorId");
CREATE INDEX "repair_jobs_workshopId_idx" ON "repair_jobs"("workshopId");

ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_surveyorId_fkey" FOREIGN KEY ("surveyorId") REFERENCES "surveyors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_jobs" ADD CONSTRAINT "repair_jobs_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
