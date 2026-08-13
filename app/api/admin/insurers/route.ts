import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { listInsurers, createInsurer } from "@/lib/masters/insurer";

export async function GET() {
  const session = await verifySession();
  try {
    const insurers = await listInsurers(session);
    return NextResponse.json(insurers);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const insurer = await createInsurer(session, body);
    return NextResponse.json(insurer, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
