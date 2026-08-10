import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getMyWork } from "@/lib/my-work/my-work";

export async function GET() {
  const session = await verifySession();
  try {
    const myWork = await getMyWork(session);
    return NextResponse.json(myWork);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
