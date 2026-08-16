import { verifySession } from "@/lib/dal";
import {
  getIntegrationStatuses,
  type IntegrationHealth,
} from "@/lib/integrations/status";

const HEALTH_LABELS: Record<IntegrationHealth, string> = {
  OK: "Configured & reachable",
  MISCONFIGURED: "Misconfigured",
  NOT_BUILT: "Not built yet",
};

const HEALTH_CLASSES: Record<IntegrationHealth, string> = {
  OK: "bg-status-green-bg text-status-green-fg",
  MISCONFIGURED: "bg-status-red-bg text-status-red-fg",
  NOT_BUILT: "bg-muted text-muted-foreground",
};

// M29: Administration > Integration Settings — a real "is this configured
// and reachable" check for every adapter the app has an interface for,
// not just an env-var echo. OCR/Email (M11/M13) resolve their actual
// provider; WhatsApp/Telematics (M10/M12) never shipped an adapter, so
// they report a static "not built yet" rather than a fabricated
// reachability result. Same underlying check GET /api/health exposes
// unauthenticated for orchestrators — see docs/INTEGRATIONS.md.
// ORG_ADMIN only, same as every other Administration screen.
export default async function AdminIntegrationsPage() {
  const session = await verifySession();

  if (session.user.role !== "ORG_ADMIN") {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">
          Only ORG_ADMIN can view integration settings.
        </p>
      </div>
    );
  }

  const statuses = await getIntegrationStatuses();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        Integration Settings
      </h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Live configured-and-reachable status for every external adapter
        this system integrates with. The same check backs the
        unauthenticated <code>GET /api/health</code> endpoint.
      </p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Integration</th>
            <th className="py-2">Provider</th>
            <th className="py-2">Status</th>
            <th className="py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {statuses.map((s) => (
            <tr key={s.key} className="border-border border-b">
              <td className="py-3 font-medium">{s.name}</td>
              <td className="text-muted-foreground py-3">
                {s.configuredProvider ?? "—"}
              </td>
              <td className="py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${HEALTH_CLASSES[s.health]}`}
                >
                  {HEALTH_LABELS[s.health]}
                </span>
              </td>
              <td className="text-muted-foreground py-3">{s.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
