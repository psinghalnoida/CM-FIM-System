import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getMyWork, type MyWorkItemKind } from "@/lib/my-work/my-work";

const KIND_LABELS: Record<MyWorkItemKind, string> = {
  INCIDENT: "Incident",
  CLAIM: "Claim",
  SURVEY: "Survey",
  REPAIR_JOB: "Repair job",
  SETTLEMENT: "Settlement",
  PAYMENT: "Payment",
  TAT_STAGE: "TAT stage",
};

// M26: My Work — a personalized "needs your action" view, scoped to the
// caller's role (see lib/my-work/my-work.ts's doc comment for exactly
// what "needs your action" means per role — reused RBAC/terminal-status
// definitions, not a new assignment concept). See docs/DASHBOARDS.md's
// M26 section.
export default async function MyWorkPage() {
  const session = await verifySession();
  const myWork = await getMyWork(session);

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">My Work</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        {myWork.items.length} item{myWork.items.length === 1 ? "" : "s"}{" "}
        needing action as {myWork.role.replaceAll("_", " ")}
      </p>

      {myWork.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {myWork.role === "AUDITOR"
            ? "Nothing to action — Auditor is a read-only role. See any record's Audit/Timeline tab for the org's activity."
            : "Nothing needs your action right now."}
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="py-2">Type</th>
              <th className="py-2">Item</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {myWork.items.map((item) => (
              <tr key={`${item.kind}-${item.id}`} className="border-border border-b">
                <td className="text-muted-foreground py-2">
                  {KIND_LABELS[item.kind]}
                </td>
                <td className="py-2 font-medium">
                  <Link
                    href={item.href}
                    className="text-primary underline underline-offset-4"
                  >
                    {item.label}
                  </Link>
                </td>
                <td className="py-2">{item.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
