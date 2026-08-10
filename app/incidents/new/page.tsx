import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listVehicles } from "@/lib/masters/vehicle";
import { listDrivers } from "@/lib/masters/driver";
import { CreateIncidentForm } from "@/components/incidents/create-incident-form";

export default async function NewIncidentPage() {
  const session = await verifySession();
  const [vehicles, drivers] = await Promise.all([
    listVehicles(session),
    listDrivers(session),
  ]);

  return (
    <div className="mx-auto max-w-lg p-8">
      <Link
        href="/incidents"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Incidents
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">
        Report an incident
      </h1>
      <CreateIncidentForm
        vehicles={vehicles.map((v) => ({
          id: v.id,
          label: v.registrationNumber,
        }))}
        drivers={drivers.map((d) => ({ id: d.id, label: d.name }))}
      />
    </div>
  );
}
