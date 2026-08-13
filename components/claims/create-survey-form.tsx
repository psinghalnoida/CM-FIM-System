"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// M27: surveyorName/surveyorContact free-text inputs replaced with a
// dropdown of Surveyor master-data rows — see docs/MASTERS.md's M27
// section. No surveyors configured yet is a real, reachable state (a
// fresh org before ORG_ADMIN has added any); the select just has
// nothing but its placeholder in that case, not hidden entirely, so the
// message is clear rather than the form silently vanishing.
export function CreateSurveyForm({
  claimId,
  surveyors,
}: {
  claimId: string;
  surveyors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      surveyorId: String(formData.get("surveyorId") ?? ""),
      scheduledAt: formData.get("scheduledAt")
        ? String(formData.get("scheduledAt"))
        : undefined,
    };

    setPending(true);
    try {
      const res = await fetch(`/api/claims/${claimId}/surveys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to schedule survey.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to schedule survey.",
      );
    } finally {
      setPending(false);
    }
  }

  if (surveyors.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No surveyors configured yet — an ORG_ADMIN adds them under
        Administration &gt; Master Data before a survey can be scheduled.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="surveyorId">Surveyor</Label>
          <select
            id="surveyorId"
            name="surveyorId"
            required
            defaultValue=""
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="" disabled>
              Select a surveyor…
            </option>
            {surveyors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="scheduledAt">Scheduled for (optional)</Label>
          <Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending} variant="outline">
        {pending ? "Scheduling…" : "Schedule survey"}
      </Button>
    </form>
  );
}
