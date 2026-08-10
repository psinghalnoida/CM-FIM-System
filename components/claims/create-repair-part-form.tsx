"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateRepairPartForm({
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
    setPending(true);
    try {
      const res = await fetch(
        `/api/claims/${claimId}/repair-jobs/${repairJobId}/parts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partName: String(formData.get("partName")) }),
        },
      );
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to add part.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add part.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <Input name="partName" placeholder="Part name" required maxLength={200} />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add part"}
      </Button>
    </form>
  );
}
