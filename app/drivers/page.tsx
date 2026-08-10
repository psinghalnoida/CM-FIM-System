import { verifySession } from "@/lib/dal";
import { listDrivers } from "@/lib/masters/driver";

export default async function DriversPage() {
  const session = await verifySession();
  const drivers = await listDrivers(session);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Drivers</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Name</th>
            <th className="py-2">License</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((driver) => (
            <tr key={driver.id} className="border-border border-b">
              <td className="py-2">{driver.name}</td>
              <td className="py-2">{driver.licenseNumber}</td>
              <td className="py-2">{driver.status}</td>
            </tr>
          ))}
          {drivers.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="text-muted-foreground py-4 text-center"
              >
                No drivers visible to your account.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
