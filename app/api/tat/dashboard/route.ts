import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getTatDashboard } from "@/lib/tat/dashboard";
import { CaseType } from "@/lib/generated/prisma/enums";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const { searchParams } = request.nextUrl;
    const caseType = searchParams.get("caseType");
    const dashboard = await getTatDashboard(session, {
      depotId: searchParams.get("depotId") ?? undefined,
      caseType: caseType && caseType in CaseType ? (caseType as CaseType) : undefined,
      breachedOnly: searchParams.get("breachedOnly") === "true",
    });
    return NextResponse.json(dashboard);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
