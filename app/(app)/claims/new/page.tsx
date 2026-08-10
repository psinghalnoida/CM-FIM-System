import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getIncident } from "@/lib/incidents/incident";
import { CreateClaimForm } from "@/components/claims/create-claim-form";

export default async function NewClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ incidentId?: string }>;
}) {
  const session = await verifySession();
  const { incidentId } = await searchParams;

  if (!incidentId) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">
          File a claim
        </h1>
        <p className="text-muted-foreground text-sm">
          A claim is filed against a specific incident — open an{" "}
          <Link
            href="/incidents"
            className="text-primary underline underline-offset-4"
          >
            incident
          </Link>{" "}
          first, then use its &ldquo;File a claim&rdquo; link.
        </p>
      </div>
    );
  }

  const incident = await getIncident(session, incidentId);
  if (!incident) notFound();

  return (
    <div className="mx-auto max-w-lg p-8">
      <Link
        href={`/incidents/${incident.id}`}
        className="text-primary text-sm underline underline-offset-4"
      >
        ← {incident.incidentNumber}
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">
        File a claim
      </h1>
      <CreateClaimForm incidentId={incident.id} />
    </div>
  );
}
