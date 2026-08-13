import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";

// M27: Broker master data. Unlike Insurer/Surveyor/Workshop, nothing
// referenced a broker before this milestone — no free text to migrate,
// no backfill. Added because the design's Master Data screen lists it;
// attaches to InsurancePolicy as an optional field (not every policy
// goes through a broker). See docs/MASTERS.md's M27 section.

export const CreateBrokerSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type CreateBrokerInput = z.infer<typeof CreateBrokerSchema>;

export const UpdateBrokerSchema = CreateBrokerSchema.partial();
export type UpdateBrokerInput = z.infer<typeof UpdateBrokerSchema>;

/** Any authenticated org member can read — reference data used when creating/displaying insurance policies. */
export async function listBrokers(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  return db.broker.findMany({ orderBy: { name: "asc" } });
}

export async function getBroker(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  return db.broker.findUnique({ where: { id } });
}

/** Creating/editing master data is ORG_ADMIN-only — see docs/MASTERS.md. */
export async function createBroker(
  session: AuthSession,
  input: CreateBrokerInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = CreateBrokerSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const broker = await db.broker.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Broker",
    entityId: broker.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: broker,
    sourceChannel: "WEB",
  });

  return broker;
}

export async function updateBroker(
  session: AuthSession,
  id: string,
  input: UpdateBrokerInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = UpdateBrokerSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const before = await db.broker.findUniqueOrThrow({ where: { id } });
  const broker = await db.broker.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Broker",
    entityId: broker.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: broker,
    sourceChannel: "WEB",
  });

  return broker;
}
