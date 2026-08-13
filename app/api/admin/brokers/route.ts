import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { listBrokers, createBroker } from "@/lib/masters/broker";

export async function GET() {
  const session = await verifySession();
  try {
    const brokers = await listBrokers(session);
    return NextResponse.json(brokers);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const broker = await createBroker(session, body);
    return NextResponse.json(broker, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
