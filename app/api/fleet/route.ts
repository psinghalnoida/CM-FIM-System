import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getFleetKpis, listFleetVehicles } from "@/lib/fleet/fleet-dashboard";
import { VehicleStatus } from "@/lib/generated/prisma/enums";

const VEHICLE_STATUSES: VehicleStatus[] = Object.values(VehicleStatus);

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const { searchParams } = request.nextUrl;
    const depotId = searchParams.get("depotId") ?? undefined;
    const status = searchParams.get("status");
    const [kpis, vehicles] = await Promise.all([
      getFleetKpis(session, { depotId }),
      listFleetVehicles(session, {
        depotId,
        status: VEHICLE_STATUSES.find((s) => s === status),
        hasOpenIncidents: searchParams.get("hasOpenIncidents") === "true",
        hasOpenClaims: searchParams.get("hasOpenClaims") === "true",
      }),
    ]);
    return NextResponse.json({ kpis, vehicles });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
