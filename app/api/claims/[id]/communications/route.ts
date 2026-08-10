import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  addClaimCommunication,
  listClaimCommunications,
} from "@/lib/claims/communication";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const communications = await listClaimCommunications(session, id);
    return NextResponse.json(communications);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const communication = await addClaimCommunication(session, id, body);
    return NextResponse.json(communication, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
