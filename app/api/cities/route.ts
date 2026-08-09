import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createCity, listCities } from "@/lib/masters/city";

export async function GET() {
  const session = await verifySession();
  const cities = await listCities(session);
  return NextResponse.json(cities);
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const city = await createCity(session, body);
    return NextResponse.json(city, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
