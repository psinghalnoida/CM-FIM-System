import "server-only";
// M30: Mitra's fixed tool surface — read-only Q&A only, per docs/SCOPE.md
// section 5's AssistantTool contract. Each tool wraps an existing
// service-layer query, called with the asking user's real AuthSession, so
// scopedDb()/RBAC/depot-scoping apply exactly as everywhere else in this
// app — no parallel access model, no new query paths written just for
// Mitra. Confirmed with the user: search + get-by-id for
// incidents/claims/vehicles, plus the caller's own My Work queue — the
// two questions a chat assistant over this data is actually good for
// ("what's the status of X", "what's on my plate"). Dashboards/reports/
// masters deliberately left out of v1.

import { z } from "zod";
import type { AuthSession } from "@/lib/dal";
import { getIncident } from "@/lib/incidents/incident";
import { getClaim } from "@/lib/claims/claim";
import { getVehicle } from "@/lib/masters/vehicle";
import { getMyWork } from "@/lib/my-work/my-work";
import { globalSearch } from "@/lib/search/search";

export interface AssistantTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Executes the tool with the caller's real session — never a system
   * principal, never bypassing scopedDb()/RBAC. Never throws: failures
   * (not found, cross-depot 403, bad args) come back as a plain
   * `{ error: string }` result so the model can explain them to the user
   * instead of the whole chat request blowing up on one bad tool call. */
  run: (session: AuthSession, args: unknown) => Promise<unknown>;
}

async function safeRun(label: string, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await fn();
    if (result === null || result === undefined) {
      return { error: `${label} not found, or not visible to your organization/depot.` };
    }
    return result;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : `${label} could not be retrieved.`,
    };
  }
}

const IdArgs = (field: string) => z.object({ [field]: z.string() });

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: "search_records",
    description:
      "Search for an incident, claim, or vehicle by its number or registration " +
      "(e.g. INC-2026-000001, CLM-2026-000001, HR56AB1001). Returns up to 5 " +
      "matches per type with their id — call get_incident/get_claim/get_vehicle " +
      "next with the matched id to see the full record.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The number or registration to search for (min 2 characters).",
        },
      },
      required: ["query"],
    },
    run: (session, args) =>
      safeRun("Search", async () => {
        // The tool's LLM-facing arg is "query" (clearer to a model than
        // "q"); globalSearch()'s own SearchQuerySchema parses "q" — map
        // between the two here rather than renaming either contract.
        const { query } = z.object({ query: z.string() }).parse(args);
        return globalSearch(session, { q: query });
      }),
  },
  {
    name: "get_incident",
    description: "Get full details for one incident by its id (a UUID, from search_records or get_my_work).",
    input_schema: {
      type: "object",
      properties: { incidentId: { type: "string" } },
      required: ["incidentId"],
    },
    run: (session, args) =>
      safeRun("Incident", async () => {
        const { incidentId } = IdArgs("incidentId").parse(args);
        return getIncident(session, incidentId);
      }),
  },
  {
    name: "get_claim",
    description: "Get full details for one claim by its id (a UUID, from search_records or get_my_work).",
    input_schema: {
      type: "object",
      properties: { claimId: { type: "string" } },
      required: ["claimId"],
    },
    run: (session, args) =>
      safeRun("Claim", async () => {
        const { claimId } = IdArgs("claimId").parse(args);
        return getClaim(session, claimId);
      }),
  },
  {
    name: "get_vehicle",
    description: "Get full details for one vehicle by its id (a UUID, from search_records).",
    input_schema: {
      type: "object",
      properties: { vehicleId: { type: "string" } },
      required: ["vehicleId"],
    },
    run: (session, args) =>
      safeRun("Vehicle", async () => {
        const { vehicleId } = IdArgs("vehicleId").parse(args);
        return getVehicle(session, vehicleId);
      }),
  },
  {
    name: "get_my_work",
    description:
      "List the caller's own outstanding action items (incidents/claims/" +
      "settlements/payments waiting on them), scoped to their role. No arguments.",
    input_schema: { type: "object", properties: {} },
    run: (session) => safeRun("My Work", () => getMyWork(session)),
  },
];
