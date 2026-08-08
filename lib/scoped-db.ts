import "server-only";
import { db } from "@/lib/db";

/**
 * Every Prisma model that has a direct `organizationId` column. This is a
 * hand-maintained list, not derived from the schema at runtime — when you
 * add a new org-scoped model to prisma/schema.prisma, add its name here
 * too, or scopedDb() silently won't filter it.
 * `lib/scoped-db.guard.test.ts` cross-checks this list against
 * prisma/schema.prisma and fails if they drift apart.
 *
 * Models deliberately NOT here: ones without their own organizationId
 * column, which are always reached through an org-scoped parent instead
 * (DocumentVersion, OcrExtraction, DocumentLink, Evidence,
 * TelematicsSnapshot, ActivityTimelineEvent, WorkshopActivity,
 * TatHoldPeriod, Payment, Session) — see docs/schema/M2A.md / M2B.md.
 */
export const ORG_SCOPED_MODELS = [
  "City",
  "Depot",
  "User",
  "Vehicle",
  "Driver",
  "Document",
  "Incident",
  "InsurancePolicy",
  "Claim",
  "Survey",
  "RepairJob",
  "TatStageTemplate",
  "CaseStageInstance",
  "EscalationRule",
  "Settlement",
  "IdCounter",
  "AuditLog",
] as const;

type OrgScopedModel = (typeof ORG_SCOPED_MODELS)[number];

function isOrgScopedModel(model: string | undefined): model is OrgScopedModel {
  return !!model && (ORG_SCOPED_MODELS as readonly string[]).includes(model);
}

// Operations where injecting `where: { organizationId }` is safe and
// correct. `create`/`createMany` are excluded — organizationId is a
// required field on every org-scoped model's create input, so Prisma's own
// types already force the caller to supply the right one; there's no
// `where` to inject into. `upsert` is also excluded: adding organizationId
// to its `where` would make a cross-org row "not found" and fall through
// to the `create` branch, which then collides on the primary key instead
// of failing cleanly — call findFirst+create/update manually instead of
// upsert on org-scoped models.
const SCOPED_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

/**
 * Returns a Prisma client scoped to one organization: every read/update/
 * delete on an org-scoped model (see ORG_SCOPED_MODELS above) automatically
 * gets `organizationId` merged into its `where`, so a missing filter in a
 * service function fails closed instead of leaking across organizations.
 *
 * This is defense-in-depth, not a replacement for services being correct —
 * see docs/AUTH.md for what it does and does not cover (notably: nested
 * relation reads/writes and raw queries are NOT scoped by this).
 */
export function scopedDb(organizationId: string) {
  return db.$extends({
    name: "org-scoping",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isOrgScopedModel(model) || !SCOPED_OPERATIONS.has(operation)) {
            return query(args);
          }
          const scopedArgs = args as { where?: Record<string, unknown> };
          scopedArgs.where = { ...scopedArgs.where, organizationId };
          return query(scopedArgs as typeof args);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
