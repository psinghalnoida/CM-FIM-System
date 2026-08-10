"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const RESPONSIBLE_PARTIES = [
  "DEPOT",
  "CLAIMS_TEAM",
  "SURVEYOR",
  "WORKSHOP",
  "CUSTOMER",
  "INSURER",
  "OTHER",
] as const;

export interface StageInstanceRow {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED";
  stageTemplate: {
    stageName: string;
    sequenceOrder: number;
    targetHours: number;
  };
  elapsed: { netHours: number; breached: boolean };
}

// Demo panel proving M8's TAT tracking end-to-end (auto-instantiated
// stages, complete/hold/end-hold, PR-02's held-time exclusion) — not a
// polished ops UI. See docs/TAT.md for what's deferred.
export function StageInstancePanel({
  instances,
}: {
  instances: StageInstanceRow[];
}) {
  const router = useRouter();
  const [holdFormFor, setHoldFormFor] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(id: string, path: string, body?: unknown) {
    setPending(id);
    setError(null);
    try {
      const res = await fetch(`/api/tat/stage-instances/${id}${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Action failed.");
      }
      setHoldFormFor(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setPending(null);
    }
  }

  async function handleStartHold(
    event: React.FormEvent<HTMLFormElement>,
    id: string,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await post(id, "/hold", {
      reason: String(formData.get("reason") ?? ""),
      responsibleParty: String(formData.get("responsibleParty") ?? "OTHER"),
    });
  }

  if (instances.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No TAT stages configured for this case type yet — see{" "}
        <a
          href="/tat/stage-templates"
          className="text-primary underline underline-offset-4"
        >
          stage templates
        </a>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Stage</th>
            <th className="py-2">Status</th>
            <th className="py-2">Elapsed / target</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => (
            <tr key={instance.id} className="border-border border-b">
              <td className="py-2">{instance.stageTemplate.stageName}</td>
              <td className="py-2">
                {instance.status}
                {instance.elapsed.breached && (
                  <span className="text-destructive ml-1 text-xs">
                    (breached)
                  </span>
                )}
              </td>
              <td className="py-2">
                {instance.elapsed.netHours.toFixed(1)}h /{" "}
                {instance.stageTemplate.targetHours}h
              </td>
              <td className="py-2">
                {instance.status === "IN_PROGRESS" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={pending === instance.id}
                      onClick={() => post(instance.id, "/complete")}
                    >
                      Complete
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending === instance.id}
                      onClick={() => setHoldFormFor(instance.id)}
                    >
                      Hold
                    </Button>
                  </div>
                )}
                {instance.status === "ON_HOLD" && (
                  <Button
                    variant="outline"
                    disabled={pending === instance.id}
                    onClick={() => post(instance.id, "/hold/end")}
                  >
                    End hold
                  </Button>
                )}
                {holdFormFor === instance.id && (
                  <form
                    onSubmit={(event) => handleStartHold(event, instance.id)}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <Input
                      name="reason"
                      placeholder="Reason"
                      required
                      maxLength={500}
                      className="h-8 w-40"
                    />
                    <select
                      name="responsibleParty"
                      className="border-input h-8 rounded-md border bg-transparent px-2 text-xs"
                      defaultValue="OTHER"
                    >
                      {RESPONSIBLE_PARTIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" disabled={pending === instance.id}>
                      Start hold
                    </Button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
