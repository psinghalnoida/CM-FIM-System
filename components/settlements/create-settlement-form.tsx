"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Demo form proving M14's settlement recording end-to-end. Not a
// polished finance UI — see docs/PAYMENTS.md for what's deferred.
export function CreateSettlementForm({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      settlementAmount: Number(formData.get("settlementAmount") ?? 0),
    };

    setPending(true);
    try {
      const res = await fetch(`/api/claims/${claimId}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to create settlement.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create settlement.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="settlementAmount">Settlement amount (INR)</Label>
        <Input
          id="settlementAmount"
          name="settlementAmount"
          type="number"
          min="0"
          step="0.01"
          required
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Creating…" : "Record settlement"}
      </Button>
    </form>
  );
}
