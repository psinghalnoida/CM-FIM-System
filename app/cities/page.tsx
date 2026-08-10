import { verifySession } from "@/lib/dal";
import { listCities } from "@/lib/masters/city";

// Simple list page proving the M4 masters service/API layer end-to-end.
// A real create/edit UI is a follow-up once the API contract has been
// used for a while — see docs/MASTERS.md.
export default async function CitiesPage() {
  const session = await verifySession();
  const cities = await listCities(session);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Cities</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Name</th>
            <th className="py-2">State</th>
          </tr>
        </thead>
        <tbody>
          {cities.map((city) => (
            <tr key={city.id} className="border-border border-b">
              <td className="py-2">{city.name}</td>
              <td className="py-2">{city.state ?? "—"}</td>
            </tr>
          ))}
          {cities.length === 0 && (
            <tr>
              <td
                colSpan={2}
                className="text-muted-foreground py-4 text-center"
              >
                No cities yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
