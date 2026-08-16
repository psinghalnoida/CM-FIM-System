import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { depotScopeFor } from "@/lib/masters/depot-scope";
import type { AuthSession } from "@/lib/dal";

// M17: global search — starts narrow (incident/claim/vehicle number,
// the three fields already indexed and cheap to search) rather than a
// broad full-text search across every entity. Driver/document
// expansion is a follow-up if this isn't enough, not built ahead of a
// stated need. See docs/SEARCH.md.

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;

const RESULTS_PER_TYPE = 5;

export interface SearchResult {
  type: "incident" | "claim" | "vehicle";
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

export async function globalSearch(
  session: AuthSession,
  input: unknown,
): Promise<SearchResult[]> {
  const { q } = SearchQuerySchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);
  // Same DEPOT_MANAGER confinement as every list endpoint (M4/M6/M7) —
  // search never surfaces a result the caller couldn't already reach
  // through the ordinary list pages.
  const depotScope = depotScopeFor(session);

  const [incidents, claims, vehicles] = await Promise.all([
    scoped.incident.findMany({
      where: {
        incidentNumber: { contains: q, mode: "insensitive" },
        depotId: depotScope ?? undefined,
      },
      select: { id: true, incidentNumber: true, incidentType: true },
      take: RESULTS_PER_TYPE,
      orderBy: { incidentDateTime: "desc" },
    }),
    scoped.claim.findMany({
      where: {
        claimNumber: { contains: q, mode: "insensitive" },
        incident: depotScope ? { depotId: depotScope } : undefined,
      },
      select: { id: true, claimNumber: true, claimType: true },
      take: RESULTS_PER_TYPE,
      orderBy: { openedAt: "desc" },
    }),
    scoped.vehicle.findMany({
      where: {
        registrationNumber: { contains: q, mode: "insensitive" },
        depotId: depotScope ?? undefined,
      },
      select: { id: true, registrationNumber: true, make: true, model: true },
      take: RESULTS_PER_TYPE,
      orderBy: { registrationNumber: "asc" },
    }),
  ]);

  return [
    ...incidents.map((i): SearchResult => ({
      type: "incident",
      id: i.id,
      label: i.incidentNumber,
      sublabel: i.incidentType,
      href: `/incidents/${i.id}`,
    })),
    ...claims.map((c): SearchResult => ({
      type: "claim",
      id: c.id,
      label: c.claimNumber,
      sublabel: c.claimType,
      href: `/claims/${c.id}`,
    })),
    ...vehicles.map((v): SearchResult => ({
      type: "vehicle",
      id: v.id,
      label: v.registrationNumber,
      sublabel: [v.make, v.model].filter(Boolean).join(" ") || "Vehicle",
      // M28: now points at the real Vehicle Detail page.
      href: `/vehicles/${v.id}`,
    })),
  ];
}
