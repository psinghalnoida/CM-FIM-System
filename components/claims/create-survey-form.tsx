"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateSurveyForm({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      surveyorName: String(formData.get("surveyorName") ?? ""),
      surveyorContact:
        String(formData.get("surveyorContact") ?? "") || undefined,
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="surveyorName">Surveyor name</Label>
          <Input
            id="surveyorName"
            name="surveyorName"
            required
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="surveyorContact">Contact (optional)</Label>
          <Input id="surveyorContact" name="surveyorContact" maxLength={100} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="scheduledAt">Scheduled for (optional)</Label>
        <Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending} variant="outline">
        {pending ? "Scheduling…" : "Schedule survey"}
      </Button>
    </form>
  );
}
