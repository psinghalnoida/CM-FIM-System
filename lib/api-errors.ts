import "server-only";
import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { DomainError } from "@/lib/domain-error";

/**
 * Standard error -> HTTP response mapping for API route handlers (M4+).
 * Call this from a route's catch block:
 *
 *   try {
 *     ...
 *   } catch (err) {
 *     return toApiErrorResponse(err);
 *   }
 *
 * Next's own control-flow errors (unauthorized()/forbidden()/redirect(),
 * thrown by requireRole()/verifySession() deeper in the call stack) must
 * NOT be caught here — unstable_rethrow lets those propagate to Next's own
 * handling instead of being turned into a generic 500.
 */
export function toApiErrorResponse(err: unknown): NextResponse {
  unstable_rethrow(err);

  if (err instanceof DomainError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Validation failed", details: err.flatten() },
      { status: 400 },
    );
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return NextResponse.json(
        {
          error: "A record with these values already exists.",
          target: err.meta?.target,
        },
        { status: 409 },
      );
    }
    if (err.code === "P2025") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  }

  console.error(err);
  return NextResponse.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}
