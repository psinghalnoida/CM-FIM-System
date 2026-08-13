"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// M27: workshopName/workshopContact free-text inputs replaced with a
// dropdown of Workshop master-data rows — see docs/MASTERS.md's M27
// section. Same "no workshops yet" handling as CreateSurveyForm.
export function CreateRepairJobForm({
  claimId,
  workshops,
}: {
  claimId: string;
  workshops: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const estimatedCost = formData.get("estimatedCost");
    const body = {
      workshopId: String(formData.get("workshopId") ?? ""),
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

  if (workshops.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No workshops configured yet — an ORG_ADMIN adds them under
        Administration &gt; Master Data before a repair job can be opened.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="workshopId">Workshop</Label>
          <select
            id="workshopId"
            name="workshopId"
            required
            defaultValue=""
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="" disabled>
              Select a workshop…
            </option>
            {workshops.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
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
