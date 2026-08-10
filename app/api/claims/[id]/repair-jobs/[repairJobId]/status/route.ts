import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { transitionRepairJobStatus } from "@/lib/claims/repair-job";
import { RepairJobStatus } from "@/lib/generated/prisma/enums";

const BodySchema = z.object({ status: z.enum(RepairJobStatus) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; repairJobId: string }> },
) {
  const session = await verifySession();
  const { repairJobId } = await params;
  try {
    const { status } = BodySchema.parse(await request.json());
    const repairJob = await transitionRepairJobStatus(
      session,
      repairJobId,
      status,
    );
    return NextResponse.json(repairJob);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
