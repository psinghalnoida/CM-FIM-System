import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listIncidents } from "@/lib/incidents/incident";

export default async function IncidentsPage() {
  const session = await verifySession();
  const incidents = await listIncidents(session);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
        <Link
          href="/incidents/new"
          className="text-primary text-sm underline underline-offset-4"
        >
          Report incident
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Number</th>
            <th className="py-2">Vehicle</th>
            <th className="py-2">Type</th>
            <th className="py-2">Severity</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id} className="border-border border-b">
              <td className="py-2">
                <Link
                  href={`/incidents/${incident.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  {incident.incidentNumber}
                </Link>
              </td>
              <td className="py-2">{incident.vehicle.registrationNumber}</td>
              <td className="py-2">{incident.incidentType}</td>
              <td className="py-2">{incident.severity}</td>
              <td className="py-2">{incident.status}</td>
            </tr>
          ))}
          {incidents.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="text-muted-foreground py-4 text-center"
              >
                No incidents visible to your account.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
