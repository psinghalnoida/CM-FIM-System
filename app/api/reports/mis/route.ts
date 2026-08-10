import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getMisReport } from "@/lib/reports/mis";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const depotId = request.nextUrl.searchParams.get("depotId");
    const report = await getMisReport(session, {
      depotId: depotId ?? undefined,
    });
    return NextResponse.json(report);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
