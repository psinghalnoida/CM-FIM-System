import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createUser, listUsers } from "@/lib/admin/user";

export async function GET() {
  const session = await verifySession();
  try {
    const users = await listUsers(session);
    return NextResponse.json(users);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const user = await createUser(session, body);
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
