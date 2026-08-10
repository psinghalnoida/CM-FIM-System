import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listVehicles } from "@/lib/masters/vehicle";

export default async function VehiclesPage() {
  const session = await verifySession();
  const vehicles = await listVehicles(session);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Vehicles</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Registration</th>
            <th className="py-2">Type</th>
            <th className="py-2">Make / Model</th>
            <th className="py-2">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <tr key={vehicle.id} className="border-border border-b">
              <td className="py-2">{vehicle.registrationNumber}</td>
              <td className="py-2">{vehicle.vehicleType}</td>
              <td className="py-2">
                {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
              </td>
              <td className="py-2">{vehicle.status}</td>
              <td className="py-2">
                <Link
                  href={`/vehicles/${vehicle.id}/documents`}
                  className="text-primary underline underline-offset-4"
                >
                  Documents
                </Link>
              </td>
            </tr>
          ))}
          {vehicles.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="text-muted-foreground py-4 text-center"
              >
                No vehicles visible to your account.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
