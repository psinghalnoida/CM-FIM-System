import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { listStageInstancesForCase } from "@/lib/tat/case-stage";

// Stage instances are never created directly through this API — they're
// auto-instantiated by createIncident()/createClaim() (lib/tat/case-stage.ts).
// This route is read-only, filtered to exactly one case via incidentId or
// claimId.
export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const incidentId = request.nextUrl.searchParams.get("incidentId");
    const claimId = request.nextUrl.searchParams.get("claimId");
    const instances = await listStageInstancesForCase(session, {
      incidentId: incidentId ?? undefined,
      claimId: claimId ?? undefined,
    });
    return NextResponse.json(instances);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
