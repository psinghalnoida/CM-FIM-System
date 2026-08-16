"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// M28: the Vehicle Detail page's Warranty tab.
export function CreateWarrantyForm({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      provider: String(formData.get("provider") ?? ""),
      coverageDescription:
        String(formData.get("coverageDescription") ?? "") || undefined,
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
    };

    setPending(true);
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/warranties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to add warranty.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add warranty.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="provider">Provider</Label>
          <Input id="provider" name="provider" required maxLength={200} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="coverageDescription">Coverage (optional)</Label>
          <Input
            id="coverageDescription"
            name="coverageDescription"
            maxLength={1000}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" required />
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add warranty"}
      </Button>
    </form>
  );
}
