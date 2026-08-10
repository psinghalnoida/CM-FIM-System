import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";

export const CreateCitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).optional(),
});
export type CreateCityInput = z.infer<typeof CreateCitySchema>;

export const UpdateCitySchema = CreateCitySchema.partial();
export type UpdateCityInput = z.infer<typeof UpdateCitySchema>;

/** Any authenticated org member can read cities — reference data used across modules. */
export async function listCities(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  return db.city.findMany({ orderBy: { name: "asc" } });
}

export async function getCity(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  return db.city.findUnique({ where: { id } });
}

/** Creating/editing org structure (cities, depots) is ORG_ADMIN-only — see docs/MASTERS.md. */
export async function createCity(session: AuthSession, input: CreateCityInput) {
  requireRole(session, "ORG_ADMIN");
  const data = CreateCitySchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const city = await db.city.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "City",
    entityId: city.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: city,
    sourceChannel: "WEB",
  });

  return city;
}

export async function updateCity(
  session: AuthSession,
  id: string,
  input: UpdateCityInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = UpdateCitySchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const before = await db.city.findUniqueOrThrow({ where: { id } });
  const city = await db.city.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "City",
    entityId: city.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: city,
    sourceChannel: "WEB",
  });

  return city;
}
