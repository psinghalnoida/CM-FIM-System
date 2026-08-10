import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { globalSearch } from "@/lib/search/search";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const results = await globalSearch(session, { q });
    return NextResponse.json(results);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
