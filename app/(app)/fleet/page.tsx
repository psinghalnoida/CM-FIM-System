import Link from "next/link";
import { verifySession } from "@/lib/dal";
import {
  getFleetKpis,
  listFleetVehicles,
} from "@/lib/fleet/fleet-dashboard";
import { listDepots } from "@/lib/masters/depot";
import { VehicleStatus } from "@/lib/generated/prisma/enums";

// M25: Fleet Dashboard — fleet-wide KPIs plus a filterable vehicle list
// (status, open incidents/claims). See docs/DASHBOARDS.md's M25 section.
export default async function FleetDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    depotId?: string;
    status?: string;
    hasOpenIncidents?: string;
    hasOpenClaims?: string;
  }>;
}) {
  const session = await verifySession();
  const params = await searchParams;
  const statusFilter =
    params.status && params.status in VehicleStatus
      ? (params.status as VehicleStatus)
      : undefined;

  const [kpis, vehicles, depots] = await Promise.all([
    getFleetKpis(session, { depotId: params.depotId }),
    listFleetVehicles(session, {
      depotId: params.depotId,
      status: statusFilter,
      hasOpenIncidents: params.hasOpenIncidents === "true",
      hasOpenClaims: params.hasOpenClaims === "true",
    }),
    listDepots(session),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        Fleet Dashboard
      </h1>
      <p className="text-muted-foreground mb-6 text-sm">
        {kpis.totalVehicles} vehicles
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border-border rounded-md border p-3">
          <div className="text-muted-foreground text-xs">Active</div>
          <div className="font-heading text-2xl">
            {kpis.statusCounts.ACTIVE}
          </div>
        </div>
        <div className="border-border rounded-md border p-3">
          <div className="text-muted-foreground text-xs">Inactive</div>
          <div className="font-heading text-2xl">
            {kpis.statusCounts.INACTIVE}
          </div>
        </div>
        <a
          className="border-border rounded-md border p-3"
          href="?hasOpenIncidents=true"
        >
          <div className="text-status-amber-fg text-xs font-semibold">
            Open incidents
          </div>
          <div className="font-heading text-2xl">
            {kpis.vehiclesWithOpenIncidents}
          </div>
        </a>
        <a
          className="border-border rounded-md border p-3"
          href="?hasOpenClaims=true"
        >
          <div className="text-status-amber-fg text-xs font-semibold">
            Open claims
          </div>
          <div className="font-heading text-2xl">
            {kpis.vehiclesWithOpenClaims}
          </div>
        </a>
      </div>

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 text-sm"
      >
        <div className="space-y-1">
          <label htmlFor="depotId" className="text-muted-foreground block">
            Depot
          </label>
          <select
            id="depotId"
            name="depotId"
            defaultValue={params.depotId ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All depots</option>
            {depots.map((depot) => (
              <option key={depot.id} value={depot.id}>
                {depot.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="status" className="text-muted-foreground block">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={params.status ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All statuses</option>
            {Object.values(VehicleStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-9 items-center gap-2">
          <input
            type="checkbox"
            name="hasOpenIncidents"
            value="true"
            defaultChecked={params.hasOpenIncidents === "true"}
          />
          Has open incidents
        </label>
        <label className="flex h-9 items-center gap-2">
          <input
            type="checkbox"
            name="hasOpenClaims"
            value="true"
            defaultChecked={params.hasOpenClaims === "true"}
          />
          Has open claims
        </label>
        <button
          type="submit"
          className="border-input h-9 rounded-md border px-3"
        >
          Apply
        </button>
      </form>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Bus No.</th>
            <th className="py-2">Depot</th>
            <th className="py-2">Status</th>
            <th className="py-2">Open incidents</th>
            <th className="py-2">Open claims</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <tr key={vehicle.id} className="border-border border-b">
              <td className="py-2 font-medium">
                <Link
                  href={`/vehicles/${vehicle.id}/documents`}
                  className="text-primary underline underline-offset-4"
                >
                  {vehicle.registrationNumber}
                </Link>
              </td>
              <td className="py-2">{vehicle.depotName}</td>
              <td className="py-2">{vehicle.status}</td>
              <td className="py-2">{vehicle.openIncidentsCount}</td>
              <td className="py-2">{vehicle.openClaimsCount}</td>
            </tr>
          ))}
          {vehicles.length === 0 && (
            <tr>
              <td colSpan={5} className="text-muted-foreground py-6 text-center">
                No vehicles match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
