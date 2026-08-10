import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listClaims } from "@/lib/claims/claim";

export default async function ClaimsPage() {
  const session = await verifySession();
  const claims = await listClaims(session);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Claims</h1>
        <Link
          href="/incidents"
          className="text-primary text-sm underline underline-offset-4"
        >
          Incidents (file a claim from one)
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Number</th>
            <th className="py-2">Incident</th>
            <th className="py-2">Type</th>
            <th className="py-2">Policy</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={claim.id} className="border-border border-b">
              <td className="py-2">
                <Link
                  href={`/claims/${claim.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  {claim.claimNumber}
                </Link>
              </td>
              <td className="py-2">{claim.incident.incidentNumber}</td>
              <td className="py-2">{claim.claimType}</td>
              <td className="py-2">
                {claim.policy ? claim.policy.policyNumber : "—"}
              </td>
              <td className="py-2">{claim.status}</td>
            </tr>
          ))}
          {claims.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="text-muted-foreground py-4 text-center"
              >
                No claims visible to your account.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
