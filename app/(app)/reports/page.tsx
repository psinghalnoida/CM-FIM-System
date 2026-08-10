import { verifySession } from "@/lib/dal";
import { getMisReport } from "@/lib/reports/mis";
import { listDepots } from "@/lib/masters/depot";

// M24: MIS Reports — claim ageing, TAT compliance %, incident-type
// frequency, and repair turnaround by depot. All four read existing
// data; nothing here is a new stored metric. See docs/DASHBOARDS.md's
// M24 section.
export default async function MisReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ depotId?: string }>;
}) {
  const session = await verifySession();
  const { depotId } = await searchParams;

  const [report, depots] = await Promise.all([
    getMisReport(session, { depotId }),
    listDepots(session),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        MIS Reports
      </h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Claim ageing, TAT compliance, incident-type frequency, and repair
        turnaround.
      </p>

      {depots.length > 1 && (
        <form method="get" className="mb-6 flex items-center gap-2 text-sm">
          <label htmlFor="depotId" className="text-muted-foreground">
            Depot
          </label>
          <select
            id="depotId"
            name="depotId"
            defaultValue={report.depotId ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
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
            className="border-input h-9 rounded-md border px-3"
          >
            Apply
          </button>
        </form>
      )}

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Claim ageing (still-open claims)
      </h2>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">0-3d</th>
            <th className="py-2">4-7d</th>
            <th className="py-2">8-14d</th>
            <th className="py-2">15d+</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-border border-b">
            <td className="py-2">{report.claimAgeing["0-3"]}</td>
            <td className="py-2">{report.claimAgeing["4-7"]}</td>
            <td className="py-2">{report.claimAgeing["8-14"]}</td>
            <td className="py-2">{report.claimAgeing["15+"]}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        TAT compliance
      </h2>
      <p className="mb-6 text-sm">
        {report.tatCompliance.compliancePercent === null ? (
          <span className="text-muted-foreground">
            No completed stages yet.
          </span>
        ) : (
          <>
            <span className="text-lg font-semibold">
              {report.tatCompliance.compliancePercent}%
            </span>{" "}
            <span className="text-muted-foreground">
              ({report.tatCompliance.compliantStages} of{" "}
              {report.tatCompliance.totalCompletedStages} completed stages
              met their target)
            </span>
          </>
        )}
      </p>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Incident-type frequency
      </h2>
      <table className="mb-6 w-full text-left text-sm">
        <tbody>
          {Object.entries(report.incidentTypeFrequency).map(
            ([type, count]) => (
              <tr key={type} className="border-border border-b">
                <td className="py-2">{type.replaceAll("_", " ")}</td>
                <td className="py-2">{count}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Repair turnaround by depot
      </h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Depot</th>
            <th className="py-2">Completed jobs</th>
            <th className="py-2">Avg. turnaround</th>
          </tr>
        </thead>
        <tbody>
          {report.repairTurnaroundByDepot.map((row) => (
            <tr key={row.depotId} className="border-border border-b">
              <td className="py-2">{row.depotName}</td>
              <td className="py-2">{row.completedJobCount}</td>
              <td className="py-2">
                {row.avgTurnaroundDays === null
                  ? "—"
                  : `${row.avgTurnaroundDays}d`}
              </td>
            </tr>
          ))}
          {report.repairTurnaroundByDepot.length === 0 && (
            <tr>
              <td colSpan={3} className="text-muted-foreground py-4 text-center">
                No depots in scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
