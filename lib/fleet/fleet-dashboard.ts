import "server-only";
import { scopedDb } from "@/lib/scoped-db";
import { depotScopeFor } from "@/lib/masters/depot-scope";
import type { AuthSession } from "@/lib/dal";
import { VehicleStatus, IncidentStatus } from "@/lib/generated/prisma/enums";
import { CLAIM_TERMINAL_STATUSES } from "@/lib/dashboards/operational-dashboard";

// M25: Fleet Dashboard — fleet-wide KPIs and a filterable vehicle list
// (status, open incidents/claims). New aggregation over existing
// Vehicle/Incident/Claim data, no new models. "Open incidents/claims"
// per vehicle reuses the exact same status definitions as M9's
// operational dashboard (IncidentStatus.OPEN;
// non-CLAIM_TERMINAL_STATUSES) rather than inventing a second notion of
// "open". See docs/DASHBOARDS.md's M25 section.

const VEHICLE_STATUSES = Object.values(VehicleStatus);

export interface FleetKpis {
  totalVehicles: number;
  statusCounts: Record<VehicleStatus, number>;
  vehiclesWithOpenIncidents: number;
  vehiclesWithOpenClaims: number;
}

export interface FleetVehicleRow {
  id: string;
  registrationNumber: string;
  depotId: string;
  depotName: string;
  status: VehicleStatus;
  openIncidentsCount: number;
  openClaimsCount: number;
}

export interface ListFleetVehiclesFilter {
  depotId?: string;
  status?: VehicleStatus;
  hasOpenIncidents?: boolean;
  hasOpenClaims?: boolean;
}

async function loadFleetRows(
  session: AuthSession,
  depotId: string | null,
): Promise<FleetVehicleRow[]> {
  const scoped = scopedDb(session.user.organizationId);
  const vehicles = await scoped.vehicle.findMany({
    where: depotId ? { depotId } : undefined,
    include: {
      depot: true,
      incidents: {
        select: {
          status: true,
          claims: { select: { status: true } },
        },
      },
    },
    orderBy: { registrationNumber: "asc" },
  });

  return vehicles.map((vehicle) => {
    const openIncidentsCount = vehicle.incidents.filter(
      (i) => i.status === IncidentStatus.OPEN,
    ).length;
    const openClaimsCount = vehicle.incidents
      .flatMap((i) => i.claims)
      .filter((c) => !CLAIM_TERMINAL_STATUSES.includes(c.status)).length;
    return {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      depotId: vehicle.depotId,
      depotName: vehicle.depot.name,
      status: vehicle.status,
      openIncidentsCount,
      openClaimsCount,
    };
  });
}

/** DEPOT_MANAGER only sees their own depot's fleet; an out-of-scope depotId filter returns empty rather than a bypass — the same pattern used throughout this codebase. */
export async function getFleetKpis(
  session: AuthSession,
  filter: { depotId?: string } = {},
): Promise<FleetKpis> {
  const depotScope = depotScopeFor(session);
  if (depotScope && filter.depotId && filter.depotId !== depotScope) {
    return {
      totalVehicles: 0,
      statusCounts: emptyStatusCounts(),
      vehiclesWithOpenIncidents: 0,
      vehiclesWithOpenClaims: 0,
    };
  }
  const depotId = depotScope ?? filter.depotId ?? null;
  const rows = await loadFleetRows(session, depotId);

  const statusCounts = emptyStatusCounts();
  for (const row of rows) statusCounts[row.status] += 1;

  return {
    totalVehicles: rows.length,
    statusCounts,
    vehiclesWithOpenIncidents: rows.filter((r) => r.openIncidentsCount > 0)
      .length,
    vehiclesWithOpenClaims: rows.filter((r) => r.openClaimsCount > 0).length,
  };
}

export async function listFleetVehicles(
  session: AuthSession,
  filter: ListFleetVehiclesFilter = {},
): Promise<FleetVehicleRow[]> {
  const depotScope = depotScopeFor(session);
  if (depotScope && filter.depotId && filter.depotId !== depotScope) {
    return [];
  }
  const depotId = depotScope ?? filter.depotId ?? null;
  const rows = await loadFleetRows(session, depotId);

  return rows
    .filter((row) => !filter.status || row.status === filter.status)
    .filter(
      (row) => !filter.hasOpenIncidents || row.openIncidentsCount > 0,
    )
    .filter((row) => !filter.hasOpenClaims || row.openClaimsCount > 0);
}

function emptyStatusCounts(): Record<VehicleStatus, number> {
  return Object.fromEntries(
    VEHICLE_STATUSES.map((status) => [status, 0]),
  ) as Record<VehicleStatus, number>;
}
