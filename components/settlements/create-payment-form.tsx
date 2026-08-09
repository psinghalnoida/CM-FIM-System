"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreatePaymentForm({
  claimId,
  settlementId,
}: {
  claimId: string;
  settlementId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      amount: Number(formData.get("amount") ?? 0),
      paymentDate: String(formData.get("paymentDate") ?? ""),
      paymentReference:
        String(formData.get("paymentReference") ?? "") || undefined,
    };

    setPending(true);
    try {
      const res = await fetch(
        `/api/claims/${claimId}/settlements/${settlementId}/payments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to record payment.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to record payment.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor={`amount-${settlementId}`}>Amount</Label>
        <Input
          id={`amount-${settlementId}`}
          name="amount"
          type="number"
          min="0"
          step="0.01"
          required
          className="w-32"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`paymentDate-${settlementId}`}>Date</Label>
        <Input
          id={`paymentDate-${settlementId}`}
          name="paymentDate"
          type="date"
          required
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`paymentReference-${settlementId}`}>
          Reference (optional)
        </Label>
        <Input
          id={`paymentReference-${settlementId}`}
          name="paymentReference"
          maxLength={200}
          className="w-40"
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Recording…" : "Add payment"}
      </Button>
    </form>
  );
}
