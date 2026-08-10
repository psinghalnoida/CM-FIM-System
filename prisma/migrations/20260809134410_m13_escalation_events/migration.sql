-- CreateTable
CREATE TABLE "escalation_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseStageInstanceId" TEXT NOT NULL,
    "escalationRuleId" TEXT NOT NULL,
    "channel" "EscalationChannel" NOT NULL,
    "notifiedEmails" TEXT[],
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escalation_events_organizationId_idx" ON "escalation_events"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_events_caseStageInstanceId_escalationRuleId_key" ON "escalation_events"("caseStageInstanceId", "escalationRuleId");

-- AddForeignKey
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_caseStageInstanceId_fkey" FOREIGN KEY ("caseStageInstanceId") REFERENCES "case_stage_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_escalationRuleId_fkey" FOREIGN KEY ("escalationRuleId") REFERENCES "escalation_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
