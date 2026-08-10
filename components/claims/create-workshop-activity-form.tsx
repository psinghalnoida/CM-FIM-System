"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ACTIVITY_TYPES = [
  "ESTIMATE_SUBMITTED",
  "PARTS_ORDERED",
  "QC_CHECK",
  "HANDOVER",
  "OTHER",
] as const;

// M19: the Repair Detail page's "Progress" tab — logs a WorkshopActivity
// (a model that's existed since M7 but had no UI of its own until now).
export function CreateWorkshopActivityForm({
  claimId,
  repairJobId,
}: {
  claimId: string;
  repairJobId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      activityType: String(formData.get("activityType")),
      notes: String(formData.get("notes") ?? "") || undefined,
    };

    setPending(true);
    try {
      const res = await fetch(
        `/api/claims/${claimId}/repair-jobs/${repairJobId}/activities`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to log activity.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log activity.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="activityType">Activity</Label>
        <select
          id="activityType"
          name="activityType"
          className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
        >
          {ACTIVITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input name="notes" id="notes" maxLength={2000} className="w-64" />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Logging…" : "Log activity"}
      </Button>
    </form>
  );
}
