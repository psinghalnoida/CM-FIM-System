"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const CLAIM_TYPES = [
  "INSURANCE",
  "WARRANTY",
  "MAINTENANCE",
  "OPERATIONAL",
  "THIRD_PARTY_RECOVERY",
  "MIXED",
] as const;

// Demo form proving M7's incident->claim conversion end-to-end. Not a
// polished claims-intake UI — see docs/CLAIMS.md for what's deferred.
export function CreateClaimForm({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      incidentId,
      claimType: String(formData.get("claimType") ?? "INSURANCE"),
    };

    setPending(true);
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to file claim.");
      }
      const claim = await res.json();
      router.push(`/claims/${claim.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to file claim.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="space-y-1">
        <Label htmlFor="claimType">Claim type</Label>
        <select
          id="claimType"
          name="claimType"
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          defaultValue="INSURANCE"
        >
          {CLAIM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          For INSURANCE/MIXED, the covering policy is auto-selected by the
          incident date (BR-05) if one exists.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Filing…" : "File claim"}
      </Button>
    </form>
  );
}
