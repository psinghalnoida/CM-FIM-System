"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateRepairJobForm({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const estimatedCost = formData.get("estimatedCost");
    const body = {
      workshopName: String(formData.get("workshopName") ?? ""),
      workshopContact:
        String(formData.get("workshopContact") ?? "") || undefined,
      estimatedCost: estimatedCost ? Number(estimatedCost) : undefined,
    };

    setPending(true);
    try {
      const res = await fetch(`/api/claims/${claimId}/repair-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to open repair job.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to open repair job.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="workshopName">Workshop</Label>
          <Input
            id="workshopName"
            name="workshopName"
            required
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="workshopContact">Contact (optional)</Label>
          <Input id="workshopContact" name="workshopContact" maxLength={100} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="estimatedCost">Estimated cost (optional)</Label>
          <Input
            id="estimatedCost"
            name="estimatedCost"
            type="number"
            min="0"
            step="0.01"
          />
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending} variant="outline">
        {pending ? "Opening…" : "Open repair job"}
      </Button>
    </form>
  );
}
