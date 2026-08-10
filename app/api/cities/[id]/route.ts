import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getCity, updateCity } from "@/lib/masters/city";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  const city = await getCity(session, id);
  if (!city) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(city);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const city = await updateCity(session, id, body);
    return NextResponse.json(city);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
