import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTatDashboard } from "@/lib/tat/dashboard";
import { listDepots } from "@/lib/masters/depot";
import { CaseType } from "@/lib/generated/prisma/enums";

// M23: TAT Dashboard — a live board of every active (IN_PROGRESS/ON_HOLD)
// stage across incidents and claims, not a report of history (that's
// M24's MIS Reports). See docs/TAT.md's M23 section.
export default async function TatDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    depotId?: string;
    caseType?: string;
    breachedOnly?: string;
  }>;
}) {
  const session = await verifySession();
  const params = await searchParams;

  const [dashboard, depots] = await Promise.all([
    getTatDashboard(session, {
      depotId: params.depotId,
      caseType:
        params.caseType && params.caseType in CaseType
          ? (params.caseType as CaseType)
          : undefined,
      breachedOnly: params.breachedOnly === "true",
    }),
    listDepots(session),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        TAT Dashboard
      </h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Every active stage across incidents and claims — not yet completed,
        already started.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border-border rounded-md border p-3">
          <div className="text-muted-foreground text-xs">Active stages</div>
          <div className="font-heading text-2xl">
            {dashboard.summary.totalActive}
          </div>
        </div>
        <div className="border-border rounded-md border p-3">
          <div className="text-muted-foreground text-xs">In progress</div>
          <div className="font-heading text-2xl">
            {dashboard.summary.inProgress}
          </div>
        </div>
        <div className="border-border rounded-md border p-3">
          <div className="text-muted-foreground text-xs">On hold</div>
          <div className="font-heading text-2xl">
            {dashboard.summary.onHold}
          </div>
        </div>
        <a
          className="border-border rounded-md border p-3"
          href="?breachedOnly=true"
        >
          <div className="text-status-red-fg text-xs font-semibold">
            Breached
          </div>
          <div className="font-heading text-2xl">
            {dashboard.summary.breached}
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
            defaultValue={dashboard.depotId ?? ""}
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
          <label htmlFor="caseType" className="text-muted-foreground block">
            Case type
          </label>
          <select
            id="caseType"
            name="caseType"
            defaultValue={params.caseType ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All case types</option>
            {Object.values(CaseType).map((type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-9 items-center gap-2">
          <input
            type="checkbox"
            name="breachedOnly"
            value="true"
            defaultChecked={params.breachedOnly === "true"}
          />
          Breached only
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
            <th className="py-2">Case</th>
            <th className="py-2">Depot</th>
            <th className="py-2">Stage</th>
            <th className="py-2">Status</th>
            <th className="py-2">Due</th>
            <th className="py-2">Net elapsed</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.rows.map((row) => (
            <tr key={row.stageInstanceId} className="border-border border-b">
              <td className="py-2 font-medium">
                <Link
                  href={
                    row.caseType === "INCIDENT"
                      ? `/incidents/${row.caseId}`
                      : `/claims/${row.caseId}`
                  }
                  className="text-primary underline underline-offset-4"
                >
                  {row.caseLabel}
                </Link>
              </td>
              <td className="py-2">{row.depotName}</td>
              <td className="py-2">{row.stageName}</td>
              <td className="py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    row.status === "ON_HOLD"
                      ? "bg-status-amber-bg text-status-amber-fg"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row.status.replaceAll("_", " ")}
                </span>
              </td>
              <td className="text-muted-foreground py-2">
                {row.dueAt ? new Date(row.dueAt).toLocaleString() : "—"}
              </td>
              <td className="py-2">
                <span
                  className={
                    row.elapsed.breached
                      ? "bg-status-red-bg text-status-red-fg rounded-full px-2 py-0.5 text-xs"
                      : "text-muted-foreground"
                  }
                >
                  {row.elapsed.netHours.toFixed(1)}h / {row.elapsed.targetHours}h
                </span>
              </td>
            </tr>
          ))}
          {dashboard.rows.length === 0 && (
            <tr>
              <td colSpan={6} className="text-muted-foreground py-6 text-center">
                No active stages match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
