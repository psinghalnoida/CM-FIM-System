import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getAssistantProvider } from "@/lib/assistant/provider";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";

const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
});

// M30: Mitra chat — protected the same way as every other API route
// (verifySession() first). The provider itself only ever runs the fixed
// ASSISTANT_TOOLS set with *this* session, so scopedDb()/RBAC apply
// exactly as everywhere else — this route is a thin transport, not a
// second access-control layer.
export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = ChatRequestSchema.parse(await request.json());
    const provider = await getAssistantProvider();
    const { reply, toolCalls } = await provider.chat(
      session,
      body.messages,
      ASSISTANT_TOOLS,
    );
    return NextResponse.json({ reply, toolCalls });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
