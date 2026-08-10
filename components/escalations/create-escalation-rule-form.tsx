"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NOTIFY_ROLES = [
  "ORG_ADMIN",
  "DEPOT_MANAGER",
  "CLAIMS_MANAGER",
  "SURVEYOR",
  "WORKSHOP_COORDINATOR",
  "FINANCE_OFFICER",
] as const;

// Demo form proving M13's escalation configuration end-to-end. Only
// notifyRole is exposed here (not notifyUserId — no user-listing
// endpoint exists yet to pick from, same reasoning M7's claim-assignment
// form skipped it); the service layer supports both. See docs/ESCALATIONS.md.
export function CreateEscalationRuleForm({
  stageTemplateId,
}: {
  stageTemplateId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      stageTemplateId,
      escalationLevel: Number(formData.get("escalationLevel") ?? 1),
      triggerAfterHoursBeyondTat: Number(
        formData.get("triggerAfterHoursBeyondTat") ?? 0,
      ),
      notifyRole: String(formData.get("notifyRole") ?? "ORG_ADMIN"),
      channel: "EMAIL",
    };

    setPending(true);
    try {
      const res = await fetch("/api/escalation-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to create escalation rule.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create escalation rule.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="escalationLevel">Level</Label>
          <Input
            id="escalationLevel"
            name="escalationLevel"
            type="number"
            min="1"
            required
            defaultValue={1}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="triggerAfterHoursBeyondTat">Hours past TAT</Label>
          <Input
            id="triggerAfterHoursBeyondTat"
            name="triggerAfterHoursBeyondTat"
            type="number"
            min="0"
            required
            defaultValue={0}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="notifyRole">Notify role</Label>
          <select
            id="notifyRole"
            name="notifyRole"
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            defaultValue="ORG_ADMIN"
          >
            {NOTIFY_ROLES.map((role) => (
              <option key={role} value={role}>
                {role.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Add escalation rule"}
      </Button>
    </form>
  );
}
