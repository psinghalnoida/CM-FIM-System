import { verifySession } from "@/lib/dal";
import { getOperationalDashboard } from "@/lib/dashboards/operational-dashboard";
import { listDepots } from "@/lib/masters/depot";

// Demo page proving M9's dashboard aggregation end-to-end — plain tables,
// not a polished ops dashboard. See docs/DASHBOARDS.md for what's
// deferred. No client-side JS needed: the depot filter is a plain GET
// form.
export default async function OperationalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ depotId?: string }>;
}) {
  const session = await verifySession();
  const { depotId } = await searchParams;

  const [dashboard, depots] = await Promise.all([
    getOperationalDashboard(session, { depotId }),
    listDepots(session),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">
        Operational dashboard
      </h1>

      {depots.length > 1 && (
        <form method="get" className="mb-6 flex items-center gap-2 text-sm">
          <label htmlFor="depotId" className="text-muted-foreground">
            Depot
          </label>
          <select
            id="depotId"
            name="depotId"
            defaultValue={dashboard.depotId ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">All depots</option>
            {depots.map((depot) => (
              <option key={depot.id} value={depot.id}>
                {depot.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="border-input h-9 rounded-md border px-3 text-sm"
          >
            Apply
          </button>
        </form>
      )}

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Incident status
      </h2>
      <table className="mb-6 w-full text-left text-sm">
        <tbody>
          {Object.entries(dashboard.incidentStatusCounts).map(
            ([status, count]) => (
              <tr key={status} className="border-border border-b">
                <td className="py-2">{status}</td>
                <td className="py-2">{count}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Claim status
      </h2>
      <table className="mb-6 w-full text-left text-sm">
        <tbody>
          {Object.entries(dashboard.claimStatusCounts).map(
            ([status, count]) => (
              <tr key={status} className="border-border border-b">
                <td className="py-2">{status}</td>
                <td className="py-2">{count}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Aging (still-open cases)
      </h2>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2"></th>
            <th className="py-2">0-3d</th>
            <th className="py-2">4-7d</th>
            <th className="py-2">8-14d</th>
            <th className="py-2">15d+</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-border border-b">
            <td className="py-2">Incidents</td>
            <td className="py-2">{dashboard.aging.incidents["0-3"]}</td>
            <td className="py-2">{dashboard.aging.incidents["4-7"]}</td>
            <td className="py-2">{dashboard.aging.incidents["8-14"]}</td>
            <td className="py-2">{dashboard.aging.incidents["15+"]}</td>
          </tr>
          <tr className="border-border border-b">
            <td className="py-2">Claims</td>
            <td className="py-2">{dashboard.aging.claims["0-3"]}</td>
            <td className="py-2">{dashboard.aging.claims["4-7"]}</td>
            <td className="py-2">{dashboard.aging.claims["8-14"]}</td>
            <td className="py-2">{dashboard.aging.claims["15+"]}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        TAT breaches — {dashboard.tatBreaches.totalCount} active (
        {dashboard.tatBreaches.incidentStageCount} incident,{" "}
        {dashboard.tatBreaches.claimStageCount} claim)
      </h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Case</th>
            <th className="py-2">Stage</th>
            <th className="py-2">Overdue by</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.tatBreaches.topBreached.map((breach) => (
            <tr key={breach.stageInstanceId} className="border-border border-b">
              <td className="py-2">{breach.caseLabel}</td>
              <td className="py-2">{breach.stageName}</td>
              <td className="py-2">{breach.overdueHours.toFixed(1)}h</td>
            </tr>
          ))}
          {dashboard.tatBreaches.topBreached.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="text-muted-foreground py-4 text-center"
              >
                No active breaches.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
