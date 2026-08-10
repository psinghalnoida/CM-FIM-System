import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getUser, updateUser } from "@/lib/admin/user";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const user = await getUser(session, id);
    if (!user)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(user);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const user = await updateUser(session, id, body);
    return NextResponse.json(user);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
