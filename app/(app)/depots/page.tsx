import { verifySession } from "@/lib/dal";
import { listDepots } from "@/lib/masters/depot";

export default async function DepotsPage() {
  const session = await verifySession();
  const depots = await listDepots(session);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Depots</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Code</th>
            <th className="py-2">Name</th>
            <th className="py-2">Address</th>
          </tr>
        </thead>
        <tbody>
          {depots.map((depot) => (
            <tr key={depot.id} className="border-border border-b">
              <td className="py-2">{depot.code}</td>
              <td className="py-2">{depot.name}</td>
              <td className="py-2">{depot.address ?? "—"}</td>
            </tr>
          ))}
          {depots.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="text-muted-foreground py-4 text-center"
              >
                No depots visible to your account.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
