-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('COMPREHENSIVE', 'THIRD_PARTY', 'STANDALONE_OD', 'OTHER');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('INSURANCE', 'WARRANTY', 'MAINTENANCE', 'OPERATIONAL', 'THIRD_PARTY_RECOVERY', 'MIXED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'UNDER_SURVEY', 'UNDER_REPAIR', 'PENDING_SETTLEMENT', 'SETTLED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RepairJobStatus" AS ENUM ('ESTIMATE_PENDING', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('INCIDENT', 'INSURANCE_CLAIM', 'WARRANTY_CLAIM', 'MAINTENANCE_CLAIM', 'OPERATIONAL_CLAIM', 'THIRD_PARTY_RECOVERY_CLAIM', 'MIXED_CLAIM');

-- CreateEnum
CREATE TYPE "CaseStageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ResponsibleParty" AS ENUM ('DEPOT', 'CLAIMS_TEAM', 'SURVEYOR', 'WORKSHOP', 'CUSTOMER', 'INSURER', 'OTHER');

-- CreateEnum
CREATE TYPE "EscalationChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER');

-- DropForeignKey
ALTER TABLE "activity_timeline_events" DROP CONSTRAINT "activity_timeline_events_incidentId_fkey";

-- AlterTable
ALTER TABLE "activity_timeline_events" ADD COLUMN     "claimId" TEXT,
ALTER COLUMN "incidentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "insurerName" TEXT NOT NULL,
    "policyType" "PolicyType" NOT NULL DEFAULT 'COMPREHENSIVE',
    "coverageStartDate" TIMESTAMP(3) NOT NULL,
    "coverageEndDate" TIMESTAMP(3) NOT NULL,
    "premiumAmount" DECIMAL(14,2),
    "sumInsuredAmount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "policyId" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "surveyNumber" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "surveyorName" TEXT NOT NULL,
    "surveyorContact" TEXT,
    "surveyorUserId" TEXT,
    "status" "SurveyStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "conductedAt" TIMESTAMP(3),
    "findings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "workshopName" TEXT NOT NULL,
    "workshopContact" TEXT,
    "workshopAddress" TEXT,
    "estimatedCost" DECIMAL(14,2),
    "approvedCost" DECIMAL(14,2),
    "actualCost" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "RepairJobStatus" NOT NULL DEFAULT 'ESTIMATE_PENDING',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_activities" (
    "id" TEXT NOT NULL,
    "repairJobId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "notes" TEXT,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tat_stage_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseType" "CaseType" NOT NULL,
    "stageKey" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "sequenceOrder" INTEGER NOT NULL,
    "targetHours" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tat_stage_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_stage_instances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT,
    "claimId" TEXT,
    "stageTemplateId" TEXT NOT NULL,
    "status" "CaseStageStatus" NOT NULL DEFAULT 'PENDING',
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_stage_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tat_hold_periods" (
    "id" TEXT NOT NULL,
    "caseStageInstanceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "responsibleParty" "ResponsibleParty" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tat_hold_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stageTemplateId" TEXT NOT NULL,
    "escalationLevel" INTEGER NOT NULL,
    "triggerAfterHoursBeyondTat" INTEGER NOT NULL,
    "notifyRole" "UserRole",
    "notifyUserId" TEXT,
    "channel" "EscalationChannel" NOT NULL DEFAULT 'EMAIL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "settlementAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentReference" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "reconciledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_policies_vehicleId_coverageStartDate_coverageEndD_idx" ON "insurance_policies"("vehicleId", "coverageStartDate", "coverageEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_organizationId_policyNumber_key" ON "insurance_policies"("organizationId", "policyNumber");

-- CreateIndex
CREATE INDEX "claims_incidentId_idx" ON "claims"("incidentId");

-- CreateIndex
CREATE INDEX "claims_organizationId_status_idx" ON "claims"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "claims_organizationId_claimNumber_key" ON "claims"("organizationId", "claimNumber");

-- CreateIndex
CREATE INDEX "surveys_claimId_idx" ON "surveys"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "surveys_organizationId_surveyNumber_key" ON "surveys"("organizationId", "surveyNumber");

-- CreateIndex
CREATE INDEX "repair_jobs_claimId_idx" ON "repair_jobs"("claimId");

-- CreateIndex
CREATE INDEX "workshop_activities_repairJobId_occurredAt_idx" ON "workshop_activities"("repairJobId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "tat_stage_templates_organizationId_caseType_stageKey_key" ON "tat_stage_templates"("organizationId", "caseType", "stageKey");

-- CreateIndex
CREATE INDEX "case_stage_instances_organizationId_status_idx" ON "case_stage_instances"("organizationId", "status");

-- CreateIndex
CREATE INDEX "case_stage_instances_incidentId_idx" ON "case_stage_instances"("incidentId");

-- CreateIndex
CREATE INDEX "case_stage_instances_claimId_idx" ON "case_stage_instances"("claimId");

-- CreateIndex
CREATE INDEX "tat_hold_periods_caseStageInstanceId_idx" ON "tat_hold_periods"("caseStageInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_rules_stageTemplateId_escalationLevel_key" ON "escalation_rules"("stageTemplateId", "escalationLevel");

-- CreateIndex
CREATE INDEX "settlements_claimId_idx" ON "settlements"("claimId");

-- CreateIndex
CREATE INDEX "payments_settlementId_idx" ON "payments"("settlementId");

-- CreateIndex
CREATE INDEX "activity_timeline_events_claimId_occurredAt_idx" ON "activity_timeline_events"("claimId", "occurredAt");

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_timeline_events" ADD CONSTRAINT "activity_timeline_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_timeline_events" ADD CONSTRAINT "activity_timeline_events_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_surveyorUserId_fkey" FOREIGN KEY ("surveyorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_jobs" ADD CONSTRAINT "repair_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_jobs" ADD CONSTRAINT "repair_jobs_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_activities" ADD CONSTRAINT "workshop_activities_repairJobId_fkey" FOREIGN KEY ("repairJobId") REFERENCES "repair_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_activities" ADD CONSTRAINT "workshop_activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tat_stage_templates" ADD CONSTRAINT "tat_stage_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_instances" ADD CONSTRAINT "case_stage_instances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_instances" ADD CONSTRAINT "case_stage_instances_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_instances" ADD CONSTRAINT "case_stage_instances_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_instances" ADD CONSTRAINT "case_stage_instances_stageTemplateId_fkey" FOREIGN KEY ("stageTemplateId") REFERENCES "tat_stage_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tat_hold_periods" ADD CONSTRAINT "tat_hold_periods_caseStageInstanceId_fkey" FOREIGN KEY ("caseStageInstanceId") REFERENCES "case_stage_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tat_hold_periods" ADD CONSTRAINT "tat_hold_periods_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_stageTemplateId_fkey" FOREIGN KEY ("stageTemplateId") REFERENCES "tat_stage_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_notifyUserId_fkey" FOREIGN KEY ("notifyUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint
-- Prisma has no declarative syntax for this yet (see docs/schema/M2B.md),
-- so it's added by hand: CaseStageInstance and ActivityTimelineEvent each
-- have exactly two possible parents (an Incident or a Claim), and exactly
-- one must be set.
ALTER TABLE "case_stage_instances" ADD CONSTRAINT "case_stage_instances_subject_check"
  CHECK (
    ("incidentId" IS NOT NULL AND "claimId" IS NULL) OR
    ("incidentId" IS NULL AND "claimId" IS NOT NULL)
  );

ALTER TABLE "activity_timeline_events" ADD CONSTRAINT "activity_timeline_events_subject_check"
  CHECK (
    ("incidentId" IS NOT NULL AND "claimId" IS NULL) OR
    ("incidentId" IS NULL AND "claimId" IS NOT NULL)
  );
