import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getOperationalDashboard } from "@/lib/dashboards/operational-dashboard";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const depotId = request.nextUrl.searchParams.get("depotId");
    const dashboard = await getOperationalDashboard(session, {
      depotId: depotId ?? undefined,
    });
    return NextResponse.json(dashboard);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
