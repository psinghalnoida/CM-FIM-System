import "server-only";
import { forbidden } from "next/navigation";
import type { AuthSession } from "@/lib/dal";

// Depot-scoping for master data (M4): org-scoping (lib/scoped-db.ts)
// applies to every role, but DEPOT_MANAGER is further restricted to its
// own depot — see docs/MASTERS.md for the reasoning and what this does
// and doesn't cover. Only DEPOT_MANAGER is narrowed here; every other role
// (ORG_ADMIN, CLAIMS_MANAGER, SURVEYOR, ...) gets full org-wide access to
// master data reads, since they need cross-depot visibility for their job
// (e.g. handling a claim from any depot).

/**
 * Returns the depotId a DEPOT_MANAGER is confined to, or null if the
 * session's role has full org-wide access (no depot restriction).
 * Throws forbidden() if the session is a DEPOT_MANAGER with no assigned
 * depot — a data-integrity gap with no legitimate scope to act in.
 */
export function depotScopeFor(session: AuthSession): string | null {
  if (session.user.role !== "DEPOT_MANAGER") return null;
  if (!session.user.depotId) {
    forbidden();
  }
  return session.user.depotId;
}

/**
 * Throws forbidden() if the session is a DEPOT_MANAGER whose scope
 * (depotScopeFor) doesn't match `depotId`. A no-op for every other role.
 */
export function assertDepotInScope(
  session: AuthSession,
  depotId: string,
): void {
  const scope = depotScopeFor(session);
  if (scope && scope !== depotId) {
    forbidden();
  }
}
