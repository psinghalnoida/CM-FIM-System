import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";

// Reference implementation of the "protected API route" pattern M3 sets up
// for M4+ to copy: verifySession() first (throws Next's unauthorized() ->
// 401 if there's no valid session), then handle the request. Route
// Handlers get the same DAL as Server Components/Actions — one auth path
// for the whole app, per docs/AUTH.md.
export async function GET() {
  const session = await verifySession();

  return NextResponse.json({
    id: session.user.id,
    organizationId: session.user.organizationId,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
  });
}
