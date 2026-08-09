import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope, depotScopeFor } from "@/lib/masters/depot-scope";
import { DomainError } from "@/lib/domain-error";
import {
  IncidentType,
  IncidentSeverity,
  ReportedVia,
} from "@/lib/generated/prisma/enums";

// BR-01: the incident is the parent record — logged once, never
// re-created under a separate root record. See docs/INCIDENTS.md.

const WRITE_ROLES = ["ORG_ADMIN", "DEPOT_MANAGER"] as const;

export const CreateIncidentSchema = z.object({
  vehicleId: z.uuid(),
  driverId: z.uuid().optional(),
  incidentDateTime: z.coerce.date(),
  incidentType: z.enum(IncidentType),
  severity: z.enum(IncidentSeverity).optional(),
  locationAddress: z.string().trim().max(500).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  description: z.string().trim().min(1).max(4000),
  reportedVia: z.enum(ReportedVia).optional(),
});
export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;

export const UpdateIncidentSchema = CreateIncidentSchema.omit({
  vehicleId: true, // the vehicle an incident happened to never changes after the fact
}).partial();
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentSchema>;

/**
 * INC-YYYY-###### via the IdCounter pattern (docs/schema/M2A.md) — the
 * counter increment and the Incident insert happen in the same
 * transaction so a crash between the two can never produce a gap-free
 * counter with a missing incident, or vice versa.
 */
async function generateIncidentNumber(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  organizationId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await tx.idCounter.upsert({
    where: {
      organizationId_entityType_year: {
        organizationId,
        entityType: "INCIDENT",
        year,
      },
    },
    create: { organizationId, entityType: "INCIDENT", year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `INC-${year}-${String(counter.lastNumber).padStart(6, "0")}`;
}

export async function createIncident(
  session: AuthSession,
  input: CreateIncidentInput,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateIncidentSchema.parse(input);

  const scoped = scopedDb(session.user.organizationId);
  const vehicle = await scoped.vehicle.findUniqueOrThrow({
    where: { id: data.vehicleId },
  });
  assertDepotInScope(session, vehicle.depotId);

  if (data.driverId) {
    // Just confirms the driver exists in this org — not depot-matched to
    // the vehicle, since a driver can legitimately be driving a vehicle
    // temporarily assigned from elsewhere. See docs/INCIDENTS.md.
    await scoped.driver.findUniqueOrThrow({ where: { id: data.driverId } });
  }

  const incident = await db.$transaction(async (tx) => {
    const incidentNumber = await generateIncidentNumber(
      tx,
      session.user.organizationId,
    );
    return tx.incident.create({
      data: {
        organizationId: session.user.organizationId,
        incidentNumber,
        vehicleId: data.vehicleId,
        driverId: data.driverId,
        depotId: vehicle.depotId,
        incidentDateTime: data.incidentDateTime,
        incidentType: data.incidentType,
        severity: data.severity,
        locationAddress: data.locationAddress,
        locationLat: data.locationLat,
        locationLng: data.locationLng,
        description: data.description,
        reportedVia: data.reportedVia,
        reportedById: session.user.id,
      },
    });
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Incident",
    entityId: incident.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: incident,
    sourceChannel: "WEB",
  });

  return incident;
}

export async function updateIncident(
  session: AuthSession,
  id: string,
  input: UpdateIncidentInput,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateIncidentSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.incident.findUniqueOrThrow({ where: { id } });
  assertDepotInScope(session, before.depotId);

  if (data.driverId) {
    await scoped.driver.findUniqueOrThrow({ where: { id: data.driverId } });
  }

  const incident = await scoped.incident.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Incident",
    entityId: incident.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: incident,
    sourceChannel: "WEB",
  });

  return incident;
}

async function transitionIncidentStatus(
  session: AuthSession,
  id: string,
  from: "OPEN" | "CLOSED",
  to: "OPEN" | "CLOSED",
) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.incident.findUniqueOrThrow({ where: { id } });
  assertDepotInScope(session, before.depotId);
  if (before.status !== from) {
    throw new DomainError(
      `Incident is already ${before.status.toLowerCase()}.`,
      409,
    );
  }

  const incident = await scoped.incident.update({
    where: { id },
    data: { status: to },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Incident",
    entityId: incident.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: incident.status },
    sourceChannel: "WEB",
  });

  return incident;
}

/**
 * No claim-aware checks yet (M7 doesn't exist) — closing an incident
 * today is purely administrative ("nothing more to do here"), not a
 * financial gate. BR-09's settlement-before-closure rule applies to Claim
 * closure, not Incident closure — see docs/INCIDENTS.md.
 */
export async function closeIncident(session: AuthSession, id: string) {
  return transitionIncidentStatus(session, id, "OPEN", "CLOSED");
}

export async function reopenIncident(session: AuthSession, id: string) {
  return transitionIncidentStatus(session, id, "CLOSED", "OPEN");
}

export async function getIncident(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  const incident = await scoped.incident.findUnique({
    where: { id },
    include: { vehicle: true, driver: true, depot: true, evidence: true },
  });
  if (!incident) return null;
  assertDepotInScope(session, incident.depotId);
  return incident;
}

export interface ListIncidentsFilter {
  status?: "OPEN" | "CLOSED";
}

/** DEPOT_MANAGER only sees incidents at their own depot; other roles see the whole org. */
export async function listIncidents(
  session: AuthSession,
  filter: ListIncidentsFilter = {},
) {
  const scoped = scopedDb(session.user.organizationId);
  const depotScope = depotScopeFor(session);
  return scoped.incident.findMany({
    where: {
      depotId: depotScope ?? undefined,
      status: filter.status,
    },
    include: { vehicle: true, driver: true },
    orderBy: { incidentDateTime: "desc" },
  });
}
