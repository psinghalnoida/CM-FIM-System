import { NextResponse } from "next/server";
import { verifySession, requireRole } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { scanAndFireEscalations } from "@/lib/escalations/scan";

// Manual trigger for the reminder scheduler, scoped to the caller's own
// org — the real schedule is a repeatable BullMQ job (workers/index.ts)
// that sweeps every org; this exists so an admin (or this milestone's
// verification) doesn't have to wait for the next tick. ORG_ADMIN-only,
// same tier as configuring the escalation hierarchy itself.
export async function POST() {
  const session = await verifySession();
  try {
    requireRole(session, "ORG_ADMIN");
    const result = await scanAndFireEscalations(session.user.organizationId);
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
